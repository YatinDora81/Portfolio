import { prisma } from "db";

export type UtmSeries = {
  days: string[];                                          // ["Jul 14", …, "Jul 27"], oldest → newest
  series: { id: string; label: string; vals: number[] }[];  // vals.length === days.length
  totalHits: number;                                       // every row in the window, incl. the dropped tail
};

/** Inclusive local-calendar-day range. */
export type UtmRange = { from: Date; to: Date };

/** Series kept on the chart before the tail is folded into "other". */
const TOP_N = 3;
/** The folded tail only earns a line if it is at least this share of all hits —
 *  below that it is noise and would just add a flat near-zero series. */
const OTHER_MIN_SHARE = 0.03;
/** Widest window we will plot: beyond a year the x-axis and the row count both blow up. */
const MAX_RANGE_DAYS = 366;

/** Default window for the tracker page, defined here so the page and the picker agree. */
export const DEFAULT_TRACKER_DAYS = 30;

/**
 * Local midnight of the calendar day `offset` days away from `from`.
 *
 * Everything in this file — the query window, the bucket keys and the axis
 * labels — is derived from Dates built this way, so all three agree on where a
 * day starts. Going through the Y/M/D constructor (rather than subtracting
 * 86_400_000 ms) also keeps the boundaries correct across a DST shift, since
 * each day is re-anchored to its own local midnight instead of drifting by an
 * hour.
 */
function localDay(from: Date, offset = 0) {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
}

/**
 * Bucket key for the *local* calendar day a timestamp falls in. Read with the
 * local getters — the same ones `localDay` writes with — so a hit at 23:00 on
 * Jul 26 keys to Jul 26 and not to Jul 27, which is what a UTC-derived key
 * would do east of Greenwich.
 */
function localDayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const RANGE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a `YYYY-MM-DD` search param into a local-midnight Date; null if absent/invalid. */
export function parseRangeParam(v: string | undefined): Date | null {
  const m = RANGE_PARAM.exec((v ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // Built from the parts on purpose: `new Date("2026-07-14")` is parsed as UTC and
  // lands on Jul 13 anywhere west of Greenwich.
  const dt = new Date(y, mo - 1, d);
  // Round-trip check rejects overflow ("2026-13-45") and two-digit-year remapping,
  // both of which the constructor would silently roll forward instead of failing.
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

/** `YYYY-MM-DD` in LOCAL time — do NOT use toISOString(), it shifts the day in any non-UTC zone. */
export function toRangeParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Per-source visit counts for an inclusive range of whole local calendar days. */
export async function getUtmSeriesForRange(range: UtmRange): Promise<UtmSeries> {
  let start = localDay(range.from);
  let end = localDay(range.to);
  if (start > end) [start, end] = [end, start]; // a backwards range is a slip, not "no days"

  // Both ends are local midnights, so a DST shift only makes the difference 23h/25h — rounding
  // absorbs that and still yields whole days. Over-long spans clamp the near end forward.
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const dayCount = Math.min(span, MAX_RANGE_DAYS);
  if (span > MAX_RANGE_DAYS) start = localDay(end, -(dayCount - 1));

  const dates = Array.from({ length: dayCount }, (_, i) => localDay(start, i));
  // A range straddling new year needs the year on the label, or Jul 14 2025 and Jul 14 2026 collide.
  const fmt: Intl.DateTimeFormatOptions = start.getFullYear() === end.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const days = dates.map((d) => d.toLocaleDateString("en-US", fmt));
  const slotOf = new Map(dates.map((d, i) => [localDayKey(d), i]));

  const rows = await prisma.utmTracker.findMany({
    // `lt` the midnight AFTER `end`, because the range includes all of `end` — an `lte: end`
    // bound would compare against that day's 00:00 and drop every hit it actually contains.
    where: { visitedAt: { gte: start, lt: localDay(end, 1) } },
    select: { source: true, visitedAt: true },
  });

  if (rows.length === 0) return { days, series: [], totalHits: 0 };

  // source → zero-filled counts, one slot per day in the window
  const buckets = new Map<string, number[]>();
  let total = 0;

  for (const r of rows) {
    const slot = slotOf.get(localDayKey(r.visitedAt));
    if (slot == null) continue; // a row that landed outside the window (clock skew)
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
      // namespaced: a real source named "other" would otherwise duplicate this id
      id: "__other",
      label: "other",
      vals: dates.map((_, i) => tail.reduce((n, s) => n + (s.vals[i] ?? 0), 0)),
    });
  }

  // The queried rows, NOT a re-sum of `series`: a sub-OTHER_MIN_SHARE tail is dropped from
  // the chart, and re-summing would under-report the header count against the tracker table.
  return { days, series, totalHits: rows.length };
}

/** Per-source visit counts for the last `dayCount` whole local calendar days. */
export async function getUtmSeries(dayCount = 14): Promise<UtmSeries> {
  const to = localDay(new Date());
  const n = Math.max(1, Math.trunc(dayCount));
  return getUtmSeriesForRange({ from: localDay(to, -(n - 1)), to });
}
