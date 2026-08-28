import "server-only";
import { eachUtcDay, toDateKey, utcDayStart, utcYesterday } from "@repo/shared/dates";
import { logger } from "@repo/shared/logger";
import { pruneOldSalts } from "./analytics-salt";
import { Prisma, prisma } from "./index";
import { pruneRateLimits } from "./rate-limit";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const EVENT_RETENTION_DAYS = 90;
const REVALOG_RETENTION_DAYS = 30;
const ROLLUP_RUN_RETENTION_DAYS = 30;

// an unbounded delete can lock the table
const DELETE_BATCH = 5000;
const MAX_BATCHES = 10;

type Task = { key: string; intervalMs: number; run: (now: Date) => Promise<string> };

const TASKS: readonly Task[] = [
  { key: "retention", intervalMs: 24 * HOUR_MS, run: pruneAnalytics },
  { key: "salt-prune", intervalMs: 24 * HOUR_MS, run: async () => `salts ${await pruneOldSalts()}` },
  {
    key: "ratelimit-prune",
    intervalMs: 6 * HOUR_MS,
    run: async () => `buckets ${await pruneRateLimits()}`,
  },
  { key: "revalog-prune", intervalMs: 24 * HOUR_MS, run: pruneRevalidationLog },
  { key: "rollup-run-prune", intervalMs: 24 * HOUR_MS, run: pruneRollupRuns },
];

export async function runPeriodicMaintenance(now = new Date()): Promise<void> {
  for (const task of TASKS) {
    try {
      if (!(await claim(task.key, task.intervalMs, now))) continue;
      const result = await task.run(now);
      await finish(task.key, result);
      logger.info("maintenance", "task ran", { task: task.key, result });
    } catch (e) {
      const error = e instanceof Error ? e.message : "unknown error";
      logger.error("maintenance", "task failed", { task: task.key, error });
      await finish(task.key, `error: ${error}`);
    }
  }
}

// the lastRunAt in the WHERE is the one just read
async function claim(key: string, intervalMs: number, now: Date): Promise<boolean> {
  const state = await prisma.maintenanceState.findUnique({
    where: { key },
    select: { lastRunAt: true },
  });

  if (!state) {
    try {
      await prisma.maintenanceState.create({ data: { key, lastRunAt: now } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  }

  if (now.getTime() - state.lastRunAt.getTime() < intervalMs) return false;

  const claimed = await prisma.maintenanceState.updateMany({
    where: { key, lastRunAt: state.lastRunAt },
    data: { lastRunAt: now },
  });
  return claimed.count === 1;
}

async function finish(key: string, result: string): Promise<void> {
  try {
    await prisma.maintenanceState.update({
      where: { key },
      data: { lastResult: result.slice(0, 500) },
    });
  } catch (e) {
    logger.error("maintenance", "state write failed", {
      task: key,
      error: e instanceof Error ? e.message : "unknown",
    });
  }
}

async function deleteBatched(build: () => Prisma.Sql): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const deleted = await prisma.$executeRaw(build());
    total += deleted;
    if (deleted < DELETE_BATCH) break;
  }
  return total;
}

async function summarisedThrough(now: Date): Promise<Date | null> {
  const anySummary = await prisma.dailyStat.findFirst({
    where: { dimension: "total" },
    select: { id: true },
  });
  if (!anySummary) return null;

  const oldest = await prisma.analyticsEvent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!oldest) return null;

  const from = utcDayStart(oldest.createdAt);
  const until = utcYesterday(now);
  if (from > until) return utcDayStart(now);

  const rows = await prisma.dailyStat.findMany({
    where: { dimension: "total", date: { gte: from, lte: until } },
    select: { date: true },
  });
  const done = new Set(rows.map((row) => toDateKey(row.date)));
  const gap = eachUtcDay(from, until).find((day) => !done.has(toDateKey(day)));

  return gap ?? utcDayStart(now);
}

async function pruneAnalytics(now: Date): Promise<string> {
  const floor = await summarisedThrough(now);
  if (!floor) return "skipped: nothing summarised yet";

  const retention = utcDayStart(now).getTime() - EVENT_RETENTION_DAYS * DAY_MS;
  const before = new Date(Math.min(retention, floor.getTime()));
  const cutoff = before.toISOString();

  const events = await deleteBatched(
    () => Prisma.sql`
      DELETE FROM "AnalyticsEvent"
      WHERE "id" IN (
        SELECT "id" FROM "AnalyticsEvent"
        WHERE "createdAt" < ${cutoff}::timestamp
        ORDER BY "id"
        LIMIT ${DELETE_BATCH}
      )
    `,
  );

  // the NOT EXISTS scans the whole event table
  const sessions = await deleteBatched(
    () => Prisma.sql`
      DELETE FROM "AnalyticsSession"
      WHERE "id" IN (
        SELECT s."id" FROM "AnalyticsSession" s
        WHERE s."startedAt" < ${cutoff}::timestamp
          AND NOT EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."sessionId" = s."id")
        ORDER BY s."id"
        LIMIT ${DELETE_BATCH}
      )
    `,
  );

  const held = retention > floor.getTime();
  return `events ${events}, sessions ${sessions}${held ? `, held at ${toDateKey(floor)} (unsummarised)` : ""}`;
}

async function pruneRevalidationLog(now: Date): Promise<string> {
  const cutoff = new Date(now.getTime() - REVALOG_RETENTION_DAYS * DAY_MS).toISOString();

  const deleted = await deleteBatched(
    () => Prisma.sql`
      DELETE FROM "RevalidationLog"
      WHERE "id" IN (
        SELECT "id" FROM "RevalidationLog"
        WHERE "createdAt" < ${cutoff}::timestamp
        ORDER BY "createdAt"
        LIMIT ${DELETE_BATCH}
      )
    `,
  );
  return `rows ${deleted}`;
}

async function pruneRollupRuns(now: Date): Promise<string> {
  const cutoff = new Date(now.getTime() - ROLLUP_RUN_RETENTION_DAYS * DAY_MS);
  const { count } = await prisma.rollupRun.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return `rollup runs ${count}`;
}
