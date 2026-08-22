import "server-only";

import { EventType, prisma } from "db";
import { eachUtcDay, toDateKey, utcDayStart } from "@repo/shared/dates";

export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];

export const DEVICES = ["desktop", "mobile", "tablet"] as const;
export type DeviceKey = (typeof DEVICES)[number];
export type Split = "all" | DeviceKey;
export const SPLITS: readonly Split[] = ["all", ...DEVICES];

/**
 * Page order, and the heights the attention ratio divides by. The heights are
 * approximate and were measured once, on a 1440×900 desktop viewport — they are a
 * denominator for ranking sections against each other, not a layout source of truth.
 */
export const SECTION_CONFIG = [
  { id: "hero", label: "Hero", heightPx: 860 },
  { id: "about", label: "About", heightPx: 1480 },
  { id: "skills", label: "Skills", heightPx: 1020 },
  { id: "experience", label: "Experience", heightPx: 1240 },
  { id: "projects", label: "Projects", heightPx: 2100 },
  { id: "blogs", label: "Blogs", heightPx: 1160 },
  { id: "contact", label: "Contact", heightPx: 1320 },
] as const;

/** The dimensions `db/rollup` writes. `dimensionsSeen` prints what is actually in the
 *  table, so a writer that renames one shows up as an unread dimension, not as zeroes. */
const DIM_TOTAL = "total";
const DIM_CHANNEL = "channel";
const DIM_SECTION = "section";

/** Plotted channels. A fifth would have to be a cycled hue or a gray, and gray fails
 *  CVD separation against `--ch4`; the rest are complete in the table instead. */
const CHANNEL_SLOTS = 4;

const TODAY_SESSION_CAP = 20_000;
const TODAY_EVENT_CAP = 50_000;
const RUN_LOG = 8;

const IST = "Asia/Kolkata";
const stampFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST, day: "2-digit", month: "short", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});
const utcDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" });
const utcLongDayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
});

const stamp = (d: Date) => `${stampFmt.format(d)} IST`;
const dayFromKey = (key: string) => new Date(`${key}T00:00:00.000Z`);

export const dayLabel = (key: string) => utcDayFmt.format(dayFromKey(key));
export const longDayLabel = (key: string) => utcLongDayFmt.format(dayFromKey(key));

export interface DayPoint {
  key: string;
  label: string;
  /** `null` is a day the rollup has not reached — the chart shows the gap, not a zero. */
  pageviews: number | null;
  sessions: number | null;
  summarized: boolean;
  isToday: boolean;
}

export interface ChannelSeries {
  id: string;
  label: string;
  values: (number | null)[];
}

export interface ChannelTotal {
  channel: string;
  sessions: number;
  share: number;
}

export interface ChannelsView {
  labels: string[];
  series: ChannelSeries[];
  totals: ChannelTotal[];
  /** Real channels past the four the ramp can colour honestly. */
  hidden: number;
}

export interface SectionRow {
  id: string;
  label: string;
  heightPx: number;
  reached: number;
  sessions: number;
  /** `null` when nothing was measured — a funnel of 0 over 0 is not 0%. */
  reachPct: number | null;
  medianMs: number | null;
  msPer100px: number | null;
}

export interface RowCount {
  table: string;
  rows: number;
  note: string;
}

export interface RunRow {
  id: string;
  day: string;
  at: string;
  status: string;
  rowsWritten: number;
  durationMs: number;
  triggeredBy: string;
  error: string | null;
}

export interface AnalyticsView {
  days: WindowDays;
  fromKey: string;
  todayKey: string;
  /** Completed days inside the window that DailyStat has no `total` row for. */
  gapDays: number;
  summarizedThroughKey: string | null;
  daysBehind: number;
  timeline: DayPoint[];
  visits: number;
  sessions: number;
  uniquesToday: number;
  sessionsToday: number;
  pageviewsToday: number;
  peakUniques: { day: string; uniques: number } | null;
  channels: ChannelsView;
  sections: Record<Split, SectionRow[]>;
  hasSectionData: Record<Split, boolean>;
  counts: RowCount[];
  dimensionsSeen: { dimension: string; rows: number }[];
  runs: RunRow[];
  maintenance: { key: string; lastRunAt: string; lastResult: string | null }[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return Math.round(s[mid] ?? 0);
  return Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

/** Median of the daily medians, each day weighted by how many visits it summarised. */
function weightedMedian(points: { value: number; weight: number }[]): number | null {
  const pts = points.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  const total = pts.reduce((n, p) => n + p.weight, 0);
  if (total === 0) return null;
  let seen = 0;
  for (const p of pts) {
    seen += p.weight;
    if (seen * 2 >= total) return Math.round(p.value);
  }
  return Math.round(pts[pts.length - 1]?.value ?? 0);
}

function asDevice(value: string | null): DeviceKey | null {
  return value !== null && (DEVICES as readonly string[]).includes(value) ? (value as DeviceKey) : null;
}

/** `COUNT` is bigint and `PERCENTILE_CONT` is double; both arrive as `unknown`. */
function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function buildRow(
  cfg: (typeof SECTION_CONFIG)[number],
  reached: number,
  sessions: number,
  medianMs: number | null,
): SectionRow {
  return {
    id: cfg.id,
    label: cfg.label,
    heightPx: cfg.heightPx,
    reached,
    sessions,
    reachPct: sessions > 0 ? Math.min(100, (reached / sessions) * 100) : null,
    medianMs,
    msPer100px: medianMs === null ? null : (medianMs / cfg.heightPx) * 100,
  };
}

type RawSection = { device: string | null; section: string | null; median: unknown; reached: unknown };
type RawDevice = { device: string | null; sessions: unknown };

export async function readAnalytics(days: WindowDays): Promise<AnalyticsView> {
  const now = new Date();
  const todayStart = utcDayStart(now);
  const todayKey = toDateKey(todayStart);
  const windowStart = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  const windowFrom = windowStart.toISOString();
  const dayKeys = eachUtcDay(windowStart, todayStart).map(toDateKey);
  const fromKey = dayKeys[0] ?? todayKey;

  const [
    stats, latest, dimensionRows, runs, maintenance,
    todaySessions, pageviewsToday, todayDwell,
    rawSections, rawDevices, counts,
  ] = await Promise.all([
    prisma.dailyStat.findMany({
      where: { date: { gte: windowStart }, dimension: { in: [DIM_TOTAL, DIM_CHANNEL, DIM_SECTION] } },
      select: {
        date: true, dimension: true, key: true,
        pageviews: true, uniques: true, sessions: true, medianMs: true, reachedCount: true,
      },
    }),
    prisma.dailyStat.aggregate({ where: { dimension: DIM_TOTAL }, _max: { date: true } }),
    prisma.dailyStat.groupBy({ by: ["dimension"], _count: { _all: true } }),
    prisma.rollupRun.findMany({ orderBy: { createdAt: "desc" }, take: RUN_LOG }),
    prisma.maintenanceState.findMany({ orderBy: { key: "asc" } }),
    prisma.analyticsSession.findMany({
      where: { startedAt: { gte: todayStart } },
      select: { visitorHash: true, channel: true, deviceType: true },
      take: TODAY_SESSION_CAP,
    }),
    prisma.analyticsEvent.count({
      where: { type: EventType.PAGEVIEW, createdAt: { gte: todayStart } },
    }),
    prisma.analyticsEvent.findMany({
      // Bounded to sessions that also started today, so the dwell numerator and the
      // session denominator below cover exactly the same visits.
      where: {
        type: EventType.SECTION_DWELL,
        createdAt: { gte: todayStart },
        session: { startedAt: { gte: todayStart } },
      },
      select: { sessionId: true, section: true, durationMs: true },
      take: TODAY_EVENT_CAP,
    }),
    // 🚨 The device split cannot come from DailyStat: the rollup summarises sections and
    // devices as separate dimensions, never crossed, so no stored row knows how mobile
    // read the projects section. These two go to the raw events instead, which means the
    // split only sees as far back as event retention — said plainly in the UI.
    // The inner GROUP BY is the same per-visit fold the today branch does in TypeScript
    // below: one flush is not one visit, so the percentile has to run over summed visits.
    prisma.$queryRaw<RawSection[]>`
      SELECT t.device                                            AS device,
             t.section                                           AS section,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.ms)   AS median,
             COUNT(*)                                            AS reached
      FROM (
        SELECT s."deviceType" AS device, e."section" AS section, e."sessionId" AS session_id,
               COALESCE(SUM(e."durationMs"), 0)::float AS ms
        FROM "AnalyticsEvent" e
        JOIN "AnalyticsSession" s ON s."id" = e."sessionId"
        WHERE e."createdAt" >= ${windowFrom}::timestamp
          AND e."type" = 'SECTION_DWELL'
          AND e."section" IS NOT NULL
          AND s."deviceType" IS NOT NULL
        GROUP BY 1, 2, 3
      ) t
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<RawDevice[]>`
      SELECT s."deviceType" AS device, COUNT(DISTINCT e."sessionId") AS sessions
      FROM "AnalyticsEvent" e
      JOIN "AnalyticsSession" s ON s."id" = e."sessionId"
      WHERE e."createdAt" >= ${windowFrom}::timestamp
        AND s."deviceType" IS NOT NULL
      GROUP BY 1
    `,
    Promise.all([
      prisma.analyticsSession.count(),
      prisma.analyticsEvent.count(),
      prisma.dailyStat.count(),
      prisma.rollupRun.count(),
      prisma.trackedLink.count(),
      prisma.linkClick.count(),
      prisma.analyticsSalt.count(),
      prisma.rateLimitBucket.count(),
      prisma.utmTracker.count(),
    ]),
  ]);

  /* ------------------------------------------------------- history, from DailyStat */

  const inWindow = new Set(dayKeys);
  const overallByDay = new Map<string, { pageviews: number; sessions: number; uniques: number }>();
  const channelByDay = new Map<string, Map<string, number>>();
  const sectionByDay = new Map<string, Map<string, { reached: number; medianMs: number }>>();

  for (const row of stats) {
    const day = toDateKey(row.date);
    if (!inWindow.has(day)) continue;

    if (row.dimension === DIM_TOTAL) {
      overallByDay.set(day, { pageviews: row.pageviews, sessions: row.sessions, uniques: row.uniques });
    } else if (row.dimension === DIM_CHANNEL) {
      const perDay = channelByDay.get(day) ?? new Map<string, number>();
      perDay.set(row.key, (perDay.get(row.key) ?? 0) + row.sessions);
      channelByDay.set(day, perDay);
    } else if (row.dimension === DIM_SECTION) {
      const perDay = sectionByDay.get(day) ?? new Map<string, { reached: number; medianMs: number }>();
      perDay.set(row.key, { reached: row.reachedCount, medianMs: row.medianMs });
      sectionByDay.set(day, perDay);
    }
  }

  /* ------------------------------------------------------------- today, from raw */

  const uniquesToday = new Set(todaySessions.map((s) => s.visitorHash)).size;
  const sessionsToday = todaySessions.length;

  const todayChannels = new Map<string, number>();
  for (const s of todaySessions) {
    todayChannels.set(s.channel, (todayChannels.get(s.channel) ?? 0) + 1);
  }

  // One visit's dwell on one section, not one flush of it: the tab-blur flush and the
  // pagehide flush are two rows describing the same stretch of attention.
  const perVisit = new Map<string, { section: string; ms: number }>();
  for (const e of todayDwell) {
    if (!e.section) continue;
    const id = `${e.sessionId} ${e.section}`;
    const existing = perVisit.get(id);
    if (existing) existing.ms += e.durationMs ?? 0;
    else perVisit.set(id, { section: e.section, ms: e.durationMs ?? 0 });
  }

  const todayBySection = new Map<string, number[]>();
  for (const visit of perVisit.values()) {
    const list = todayBySection.get(visit.section);
    if (list) list.push(visit.ms);
    else todayBySection.set(visit.section, [visit.ms]);
  }

  /* ---------------------------------------------------------------- the timeline */

  const timeline: DayPoint[] = dayKeys.map((key) => {
    if (key === todayKey) {
      return {
        key, label: dayLabel(key),
        pageviews: pageviewsToday, sessions: sessionsToday,
        summarized: false, isToday: true,
      };
    }
    const row = overallByDay.get(key);
    return {
      key,
      label: dayLabel(key),
      pageviews: row?.pageviews ?? null,
      sessions: row?.sessions ?? null,
      summarized: row !== undefined,
      isToday: false,
    };
  });

  const visits = timeline.reduce((n, d) => n + (d.pageviews ?? 0), 0);
  const sessions = timeline.reduce((n, d) => n + (d.sessions ?? 0), 0);
  const gapDays = timeline.filter((d) => !d.isToday && !d.summarized).length;

  let peakUniques: { day: string; uniques: number } | null = null;
  for (const [key, row] of overallByDay) {
    if (row.uniques > (peakUniques?.uniques ?? 0)) peakUniques = { day: dayLabel(key), uniques: row.uniques };
  }
  if (uniquesToday > (peakUniques?.uniques ?? 0)) {
    peakUniques = { day: dayLabel(todayKey), uniques: uniquesToday };
  }

  /* ------------------------------------------------------------------- channels */

  const channelTotals = new Map<string, number>();
  for (const perDay of channelByDay.values()) {
    for (const [channel, n] of perDay) channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + n);
  }
  for (const [channel, n] of todayChannels) {
    channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + n);
  }

  const channelSessions = [...channelTotals.values()].reduce((a, b) => a + b, 0);
  const totals: ChannelTotal[] = [...channelTotals.entries()]
    .map(([channel, n]) => ({ channel, sessions: n, share: channelSessions > 0 ? (n / channelSessions) * 100 : 0 }))
    .sort((a, b) => b.sessions - a.sessions || a.channel.localeCompare(b.channel));

  const plotted = totals.slice(0, CHANNEL_SLOTS);
  const channels: ChannelsView = {
    labels: timeline.map((d) => d.label),
    series: plotted.map((t) => ({
      id: t.channel,
      label: t.channel,
      values: dayKeys.map((key) => {
        if (key === todayKey) return todayChannels.get(t.channel) ?? 0;
        const perDay = channelByDay.get(key);
        return perDay ? (perDay.get(t.channel) ?? 0) : null;
      }),
    })),
    totals,
    hidden: Math.max(0, totals.length - plotted.length),
  };

  /* --------------------------------------------------- sections: all, then devices */

  const allRows = SECTION_CONFIG.map((cfg) => {
    let reached = 0;
    let denominator = 0;
    const medians: { value: number; weight: number }[] = [];

    for (const key of dayKeys) {
      if (key === todayKey) {
        const values = todayBySection.get(cfg.id) ?? [];
        reached += values.length;
        if (values.length > 0) medians.push({ value: median(values), weight: values.length });
        denominator += sessionsToday;
        continue;
      }
      const perSection = sectionByDay.get(key);
      const row = perSection?.get(cfg.id);
      if (row) {
        reached += row.reached;
        if (row.medianMs > 0) medians.push({ value: row.medianMs, weight: Math.max(1, row.reached) });
      }
      // A summarized day with reach but no total row still has a floor: the widest
      // section reached. Without it the percentage would divide by less than it counts.
      const floor = perSection ? Math.max(0, ...[...perSection.values()].map((s) => s.reached)) : 0;
      denominator += Math.max(overallByDay.get(key)?.sessions ?? 0, floor);
    }

    return buildRow(cfg, reached, denominator, weightedMedian(medians));
  });

  const deviceDenominator = new Map<DeviceKey, number>();
  for (const row of rawDevices) {
    const device = asDevice(row.device);
    if (device) deviceDenominator.set(device, toInt(row.sessions));
  }

  const deviceSections = new Map<DeviceKey, Map<string, { reached: number; medianMs: number }>>();
  for (const row of rawSections) {
    const device = asDevice(row.device);
    if (!device || !row.section) continue;
    const perDevice = deviceSections.get(device) ?? new Map<string, { reached: number; medianMs: number }>();
    perDevice.set(row.section, { reached: toInt(row.reached), medianMs: toInt(row.median) });
    deviceSections.set(device, perDevice);
  }

  const sectionRows = { all: allRows } as Record<Split, SectionRow[]>;
  for (const device of DEVICES) {
    const perDevice = deviceSections.get(device);
    const denominator = deviceDenominator.get(device) ?? 0;
    sectionRows[device] = SECTION_CONFIG.map((cfg) => {
      const row = perDevice?.get(cfg.id);
      return buildRow(
        cfg,
        row?.reached ?? 0,
        Math.max(denominator, row?.reached ?? 0),
        row && row.medianMs > 0 ? row.medianMs : null,
      );
    });
  }

  const hasSectionData = {} as Record<Split, boolean>;
  for (const split of SPLITS) hasSectionData[split] = sectionRows[split].some((r) => r.reached > 0);

  /* --------------------------------------------------------------- status & rows */

  const latestKey = latest._max.date ? toDateKey(latest._max.date) : null;
  const yesterday = new Date(todayStart.getTime() - 86_400_000);
  const daysBehind = latestKey
    ? Math.max(0, Math.round((yesterday.getTime() - dayFromKey(latestKey).getTime()) / 86_400_000))
    : 0;

  const [
    sessionRows, eventRows, dailyStatRows, rollupRunRows,
    trackedLinkRows, linkClickRows, saltRows, rateLimitRows, utmRows,
  ] = counts;

  return {
    days,
    fromKey,
    todayKey,
    gapDays,
    summarizedThroughKey: latestKey,
    daysBehind,
    timeline,
    visits,
    sessions,
    uniquesToday,
    sessionsToday,
    pageviewsToday,
    peakUniques,
    channels,
    sections: sectionRows,
    hasSectionData,
    dimensionsSeen: dimensionRows
      .map((d) => ({ dimension: d.dimension, rows: d._count._all }))
      .sort((a, b) => b.rows - a.rows),
    counts: [
      { table: "AnalyticsSession", rows: sessionRows, note: "one per visit, salted daily" },
      { table: "AnalyticsEvent", rows: eventRows, note: "pageviews, section dwell, clicks" },
      { table: "DailyStat", rows: dailyStatRows, note: "what the rollup writes" },
      { table: "RollupRun", rows: rollupRunRows, note: "one per day summarized" },
      { table: "TrackedLink", rows: trackedLinkRows, note: "short links in the registry" },
      { table: "LinkClick", rows: linkClickRows, note: "clicks on those links" },
      { table: "AnalyticsSalt", rows: saltRows, note: "one per day, pruned by maintenance" },
      { table: "RateLimitBucket", rows: rateLimitRows, note: "live windows, pruned by maintenance" },
      { table: "UtmTracker", rows: utmRows, note: "the older UTM capture, kept separate" },
    ],
    runs: runs.map((r) => ({
      id: r.id,
      day: longDayLabel(toDateKey(r.date)),
      at: stamp(r.createdAt),
      status: r.status,
      rowsWritten: r.rowsWritten,
      durationMs: r.durationMs,
      triggeredBy: r.triggeredBy,
      error: r.error,
    })),
    maintenance: maintenance.map((m) => ({
      key: m.key,
      lastRunAt: stamp(m.lastRunAt),
      lastResult: m.lastResult,
    })),
  };
}
