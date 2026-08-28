import { prisma } from "db";

export type UtmSeries = {
  days: string[];
  series: { id: string; label: string; vals: number[] }[];
  totalHits: number;
};

export type UtmRange = { from: Date; to: Date };

const TOP_N = 3;
const OTHER_MIN_SHARE = 0.03;
const MAX_RANGE_DAYS = 366;

export const DEFAULT_TRACKER_DAYS = 30;

function localDay(from: Date, offset = 0) {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
}

function localDayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const RANGE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseRangeParam(v: string | undefined): Date | null {
  const m = RANGE_PARAM.exec((v ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // built from parts; the string form parses as UTC
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

export function toRangeParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function getUtmSeriesForRange(range: UtmRange): Promise<UtmSeries> {
  let start = localDay(range.from);
  let end = localDay(range.to);
  if (start > end) [start, end] = [end, start];

  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const dayCount = Math.min(span, MAX_RANGE_DAYS);
  if (span > MAX_RANGE_DAYS) start = localDay(end, -(dayCount - 1));

  const dates = Array.from({ length: dayCount }, (_, i) => localDay(start, i));
  const fmt: Intl.DateTimeFormatOptions = start.getFullYear() === end.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const days = dates.map((d) => d.toLocaleDateString("en-US", fmt));
  const slotOf = new Map(dates.map((d, i) => [localDayKey(d), i]));

  const rows = await prisma.utmTracker.findMany({
    // lt midnight after end, so end's own hits count
    where: { visitedAt: { gte: start, lt: localDay(end, 1) } },
    select: { source: true, visitedAt: true },
  });

  if (rows.length === 0) return { days, series: [], totalHits: 0 };

  const buckets = new Map<string, number[]>();
  let total = 0;

  for (const r of rows) {
    const slot = slotOf.get(localDayKey(r.visitedAt));
    if (slot == null) continue;
    const source = (r.source ?? "").trim() || "direct";
    let vals = buckets.get(source);
    if (!vals) {
      vals = new Array<number>(dayCount).fill(0);
      buckets.set(source, vals);
    }
    vals[slot] = (vals[slot] ?? 0) + 1;
    total++;
  }

  const ranked = [...buckets.entries()]
    .map(([id, vals]) => ({ id, label: id, vals, sum: vals.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.sum - a.sum || a.id.localeCompare(b.id));

  const top = ranked.slice(0, TOP_N);
  const tail = ranked.slice(TOP_N);
  const tailSum = tail.reduce((n, s) => n + s.sum, 0);

  const series = top.map(({ id, label, vals }) => ({ id, label, vals }));
  if (tailSum > 0 && tailSum >= total * OTHER_MIN_SHARE) {
    series.push({
      // namespaced against a real source named "other"
      id: "__other",
      label: "other",
      vals: dates.map((_, i) => tail.reduce((n, s) => n + (s.vals[i] ?? 0), 0)),
    });
  }

  return { days, series, totalHits: rows.length };
}

export async function getUtmSeries(dayCount = 14): Promise<UtmSeries> {
  const to = localDay(new Date());
  const n = Math.max(1, Math.trunc(dayCount));
  return getUtmSeriesForRange({ from: localDay(to, -(n - 1)), to });
}
