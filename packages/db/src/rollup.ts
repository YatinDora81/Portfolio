import "server-only";
import { eachUtcDay, toDateKey, utcDayEnd, utcDayStart, utcYesterday } from "@repo/shared/dates";
import { logger } from "@repo/shared/logger";
import { Prisma, prisma } from "./index";
import { acquireLock } from "./lock";

const LOCK_TTL_MS = 120_000;
const TOTAL_KEY = "—";
const UNKNOWN_KEY = "unknown";
const OTHER_KEY = "(other)";

/** `path` and `referrer` are keyed on unauthenticated input and DailyStat is never
 *  pruned, so the tail is folded into one row rather than stored key by key. */
const KEY_CAP = 200;

/** Rows per INSERT. Nine bound values a row, so ~4500 parameters — well inside what
 *  Postgres accepts, and one round trip instead of five hundred. */
const WRITE_CHUNK = 500;

/** Gone two months, a load summarises five days and renders; the rest converge over the next few. */
export const MAX_DAYS_PER_REQUEST = 5;

export type RollupResult = { ok: boolean; rows: number; error?: string };

export type StatRow = {
  dimension: string;
  key: string;
  pageviews: number;
  uniques: number;
  sessions: number;
  avgDurationMs: number;
  medianMs: number;
  reachedCount: number;
};

// These column names are the only identifiers ever handed to `Prisma.raw`.
// `cap` is null where the range is bounded by something other than a visitor: a
// resolved channel, an ISO country, one of three device types.
const GROUPED = [
  { dimension: "channel", column: "channel", skipNull: false, cap: null },
  { dimension: "country", column: "country", skipNull: false, cap: null },
  { dimension: "device", column: "deviceType", skipNull: false, cap: null },
  // Null here is direct traffic, which is not a referrer.
  { dimension: "referrer", column: "referrerHost", skipNull: true, cap: KEY_CAP },
] as const;

type CountRow = { pageviews: unknown; uniques: unknown; sessions: unknown; events: unknown };
type GroupedRow = { key: string | null; pageviews: unknown; uniques: unknown; sessions: unknown };
type PathRow = { key: string | null; pageviews: unknown };
type SectionRow = { key: string | null; median: unknown; avg: unknown; reached: unknown };

const INT4_MAX = 2147483647;

// Clamped because every target column is INTEGER: one visit whose summed dwell
// outruns int4 made the whole day's insert fail, and a day that can never be
// summarised pins the retention floor and blocks pruning forever.
function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n), 0), INT4_MAX);
}

function blank(dimension: string, key: string): StatRow {
  return {
    dimension,
    key,
    pageviews: 0,
    uniques: 0,
    sessions: 0,
    avgDurationMs: 0,
    medianMs: 0,
    reachedCount: 0,
  };
}

async function computeDay(
  dayStart: Date,
  dayEnd: Date,
): Promise<{ rows: StatRow[]; events: number }> {
  // Cast in SQL rather than trusting a driver to serialise a Date against a
  // `timestamp(3)` column: the ISO string is UTC wall-clock either way.
  const from = dayStart.toISOString();
  const to = dayEnd.toISOString();

  const totals = await prisma.$queryRaw<CountRow[]>`
    SELECT
      COUNT(*) FILTER (WHERE e."type" = 'PAGEVIEW') AS pageviews,
      COUNT(DISTINCT s."visitorHash")               AS uniques,
      COUNT(DISTINCT e."sessionId")                 AS sessions,
      COUNT(*)                                      AS events
    FROM "AnalyticsEvent" e
    JOIN "AnalyticsSession" s ON s."id" = e."sessionId"
    WHERE e."createdAt" >= ${from}::timestamp
      AND e."createdAt" <  ${to}::timestamp
  `;

  const total = totals[0];
  const events = toInt(total?.events);

  const rows: StatRow[] = [
    {
      ...blank("total", TOTAL_KEY),
      pageviews: toInt(total?.pageviews),
      uniques: toInt(total?.uniques),
      sessions: toInt(total?.sessions),
    },
  ];

  if (events === 0) return { rows, events };

  for (const { dimension, column, skipNull, cap } of GROUPED) {
    const col = Prisma.raw(`s."${column}"`);

    // Re-aggregating against the top-N list rather than summing a tail keeps
    // `uniques` a real distinct count in the `(other)` row.
    const top =
      cap === null
        ? Prisma.empty
        : Prisma.sql`
      WITH top AS (
        SELECT ${col} AS k
        FROM "AnalyticsEvent" e
        JOIN "AnalyticsSession" s ON s."id" = e."sessionId"
        WHERE e."createdAt" >= ${from}::timestamp
          AND e."createdAt" <  ${to}::timestamp
          AND ${col} IS NOT NULL
        GROUP BY 1
        ORDER BY COUNT(*) DESC, 1
        LIMIT ${cap}
      )
    `;
    const join = cap === null ? Prisma.empty : Prisma.sql`LEFT JOIN top t ON t.k = ${col}`;
    const keyExpr =
      cap === null
        ? Prisma.sql`COALESCE(${col}, ${UNKNOWN_KEY})`
        : Prisma.sql`CASE
             WHEN ${col} IS NULL THEN ${UNKNOWN_KEY}
             WHEN t.k IS NULL    THEN ${OTHER_KEY}
             ELSE ${col} END`;

    const grouped = await prisma.$queryRaw<GroupedRow[]>`
      ${top}
      SELECT ${keyExpr}                              AS key,
             COUNT(*) FILTER (WHERE e."type" = 'PAGEVIEW') AS pageviews,
             COUNT(DISTINCT s."visitorHash")         AS uniques,
             COUNT(DISTINCT e."sessionId")           AS sessions
      FROM "AnalyticsEvent" e
      JOIN "AnalyticsSession" s ON s."id" = e."sessionId"
      ${join}
      WHERE e."createdAt" >= ${from}::timestamp
        AND e."createdAt" <  ${to}::timestamp
        ${skipNull ? Prisma.sql`AND ${col} IS NOT NULL` : Prisma.empty}
      GROUP BY 1
    `;

    for (const row of grouped) {
      rows.push({
        ...blank(dimension, row.key ?? UNKNOWN_KEY),
        pageviews: toInt(row.pageviews),
        uniques: toInt(row.uniques),
        sessions: toInt(row.sessions),
      });
    }
  }

  const paths = await prisma.$queryRaw<PathRow[]>`
    WITH top AS (
      SELECT e."path" AS k
      FROM "AnalyticsEvent" e
      WHERE e."createdAt" >= ${from}::timestamp
        AND e."createdAt" <  ${to}::timestamp
        AND e."type" = 'PAGEVIEW'
      GROUP BY 1
      ORDER BY COUNT(*) DESC, 1
      LIMIT ${KEY_CAP}
    )
    SELECT CASE WHEN t.k IS NULL THEN ${OTHER_KEY} ELSE e."path" END AS key,
           COUNT(*) AS pageviews
    FROM "AnalyticsEvent" e
    LEFT JOIN top t ON t.k = e."path"
    WHERE e."createdAt" >= ${from}::timestamp
      AND e."createdAt" <  ${to}::timestamp
      AND e."type" = 'PAGEVIEW'
    GROUP BY 1
  `;

  for (const row of paths) {
    rows.push({ ...blank("path", row.key ?? UNKNOWN_KEY), pageviews: toInt(row.pageviews) });
  }

  // 🚨 The median, not the mean. Dwell is heavily right-skewed — one visitor who
  // left a tab open for an hour moves an average and does not move this.
  // 🚨 And the median of visits, not of flushes: the client sends one row per flush
  // and zeroes its banked total, so a tab-hide and the pagehide that follows are two
  // rows describing one stretch of attention. Summing per session first keeps the
  // percentile and `reached` in the same unit — both are per visit.
  const sections = await prisma.$queryRaw<SectionRow[]>`
    SELECT t."section"                                          AS key,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.ms)    AS median,
           AVG(t.ms)                                            AS avg,
           COUNT(*)                                             AS reached
    FROM (
      SELECT e."sessionId", e."section", COALESCE(SUM(e."durationMs"), 0)::float AS ms
      FROM "AnalyticsEvent" e
      WHERE e."createdAt" >= ${from}::timestamp
        AND e."createdAt" <  ${to}::timestamp
        AND e."type" = 'SECTION_DWELL'
        AND e."section" IS NOT NULL
      GROUP BY 1, 2
    ) t
    GROUP BY 1
  `;

  for (const row of sections) {
    if (row.key === null) continue;
    rows.push({
      ...blank("section", row.key),
      avgDurationMs: toInt(row.avg),
      medianMs: toInt(row.median),
      reachedCount: toInt(row.reached),
    });
  }

  return { rows, events };
}

/**
 * 🚨 Every write is an upsert on `@@unique([date, dimension, key])`. A `create`
 * here would double every number each time the re-summarise button was pressed.
 * One statement per chunk, not one per row: 400 upserts is 400 round trips inside
 * one transaction, which runs past Postgres' 5s transaction timeout on a remote
 * database and fails the whole day — on exactly the days worth summarising.
 */
function writes(dayStart: Date, rows: StatRow[]): Prisma.PrismaPromise<number>[] {
  // Last wins, as the upsert-per-row did: `unknown` from a NULL and a literal
  // "unknown" would otherwise hit the same conflict target twice in one statement.
  const unique = new Map(rows.map((row) => [`${row.dimension} ${row.key}`, row]));
  const deduped = [...unique.values()];
  const date = dayStart.toISOString();

  const out: Prisma.PrismaPromise<number>[] = [];
  for (let i = 0; i < deduped.length; i += WRITE_CHUNK) {
    const values = deduped.slice(i, i + WRITE_CHUNK).map(
      (r) => Prisma.sql`(
        gen_random_uuid()::text, ${date}::date, ${r.dimension}, ${r.key},
        ${r.pageviews}, ${r.uniques}, ${r.sessions},
        ${r.avgDurationMs}, ${r.medianMs}, ${r.reachedCount}, NOW()
      )`,
    );
    out.push(
      prisma.$executeRaw`
        INSERT INTO "DailyStat" (
          "id", "date", "dimension", "key",
          "pageviews", "uniques", "sessions",
          "avgDurationMs", "medianMs", "reachedCount", "computedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("date", "dimension", "key") DO UPDATE SET
          "pageviews"     = EXCLUDED."pageviews",
          "uniques"       = EXCLUDED."uniques",
          "sessions"      = EXCLUDED."sessions",
          "avgDurationMs" = EXCLUDED."avgDurationMs",
          "medianMs"      = EXCLUDED."medianMs",
          "reachedCount"  = EXCLUDED."reachedCount",
          "computedAt"    = NOW()
      `,
    );
  }
  return out;
}

export async function rollupDay(date: Date, triggeredBy: string): Promise<RollupResult> {
  const dayStart = utcDayStart(date);
  const dayEnd = utcDayEnd(date);
  const dateKey = toDateKey(date);

  const release = await acquireLock(`rollup:${dateKey}`, LOCK_TTL_MS);
  if (!release) return { ok: false, rows: 0, error: "another rollup in progress" };

  const began = Date.now();
  try {
    const { rows, events } = await computeDay(dayStart, dayEnd);

    // Raw events expire at 90 days but summaries never do, so a day whose events
    // are gone must not be re-summarised down to zeroes. A day that genuinely had
    // no traffic still gets its zero row, or catch-up would retry it forever.
    if (events === 0) {
      const existing = await prisma.dailyStat.findUnique({
        where: { date_dimension_key: { date: dayStart, dimension: "total", key: TOTAL_KEY } },
        select: { pageviews: true, sessions: true },
      });
      if (existing && (existing.pageviews > 0 || existing.sessions > 0)) {
        await recordRun(dayStart, "skipped", 0, Date.now() - began, triggeredBy, null);
        return { ok: true, rows: 0 };
      }
    }

    await prisma.$transaction(writes(dayStart, rows));

    await recordRun(dayStart, "ok", rows.length, Date.now() - began, triggeredBy, null);
    return { ok: true, rows: rows.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown error";
    logger.error("rollup", "day failed", { date: dateKey, error });
    await recordRun(dayStart, "error", 0, Date.now() - began, triggeredBy, error);
    return { ok: false, rows: 0, error };
  } finally {
    await release();
  }
}

async function recordRun(
  date: Date,
  status: string,
  rowsWritten: number,
  durationMs: number,
  triggeredBy: string,
  error: string | null,
): Promise<void> {
  try {
    await prisma.rollupRun.create({
      data: { date, status, rowsWritten, durationMs, triggeredBy, error: error?.slice(0, 500) },
    });
  } catch (e) {
    logger.error("rollup", "run log failed", { error: e instanceof Error ? e.message : "unknown" });
  }
}

// Newest day first: a dashboard opened after a long gap shows this week before last month.
export async function catchUpRollups(
  now = new Date(),
): Promise<{ processed: string[]; remaining: number }> {
  const first = await prisma.analyticsEvent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!first) return { processed: [], remaining: 0 };

  const from = utcDayStart(first.createdAt);
  const until = utcYesterday(now);
  if (from > until) return { processed: [], remaining: 0 };

  const summarised = await prisma.dailyStat.findMany({
    where: { dimension: "total", date: { gte: from, lte: until } },
    select: { date: true },
  });
  const done = new Set(summarised.map((row) => toDateKey(row.date)));

  const missing = eachUtcDay(from, until)
    .filter((day) => !done.has(toDateKey(day)))
    .reverse();

  const processed: string[] = [];
  for (const day of missing.slice(0, MAX_DAYS_PER_REQUEST)) {
    const result = await rollupDay(day, "catch-up");
    if (result.ok) processed.push(toDateKey(day));
  }

  return { processed, remaining: missing.length - processed.length };
}
