import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import UtmTracerChart from "@/components/utm-tracer-chart";
import UtmRangePicker from "@/components/utm-range-picker";
import {
  DEFAULT_TRACKER_DAYS, getUtmSeriesForRange, parseRangeParam, toRangeParam,
} from "@/lib/utm";
import { TrackerTable } from "./table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Rows handed to the table; the chart still counts every hit in the window. */
const ROW_CAP = 2000;
/** Mirrors the cap inside `@/lib/utm`: applying it here too keeps a hand-typed
 *  five-year URL from giving the table a window the clamped chart never plots. */
const MAX_RANGE_DAYS = 366;

/** Local midnight `offset` days from `d` — the same anchoring `@/lib/utm` buckets by,
 *  so the table's bounds and the chart's columns cover exactly the same hits. */
function localDay(d: Date, offset = 0) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

/** `?from=a&from=b` arrives as an array; take the first rather than blowing up on it. */
function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrackerPage({
  searchParams,
}: {
  // Next 16 hands server components a Promise here, so it has to be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // One "today" for the whole render, handed to the picker too: the window, the chart's
  // columns and the table's bounds are all minted here, so the guard rails and the preset
  // highlight have to read the same clock or they disagree with what is on screen.
  const today = localDay(new Date());
  let to = parseRangeParam(one(sp.to)) ?? today;
  let from = parseRangeParam(one(sp.from)) ?? localDay(to, -(DEFAULT_TRACKER_DAYS - 1));
  if (from > to) [from, to] = [to, from]; // a backwards range is a slip, not "no days"
  // Both ends are local midnights, so a DST shift only makes this 23h/25h — rounding absorbs it.
  if (Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1 > MAX_RANGE_DAYS) {
    from = localDay(to, -(MAX_RANGE_DAYS - 1));
  }

  const [utm, rows] = await Promise.all([
    getUtmSeriesForRange({ from, to }),
    prisma.utmTracker.findMany({
      // `lt` the midnight AFTER `to`, because the range includes all of `to` — an
      // `lte: to` bound compares against that day's 00:00 and drops everything in it.
      where: { visitedAt: { gte: from, lt: localDay(to, 1) } },
      orderBy: { visitedAt: "desc" },
      take: ROW_CAP,
    }),
  ]);

  // Reuse the chart's own axis labels so the header, the subtitle and the x-axis can
  // never disagree — and both pick up the year on a range that straddles one.
  const first = utm.days[0] ?? "";
  const last = utm.days[utm.days.length - 1] ?? first;
  const span = first === last ? first : `${first} – ${last}`;

  return (
    <div className="view wide">
      <PageHeader
        eyebrow="outreach · attribution"
        title="Tracker"
        description={
          rows.length < utm.totalHits
            ? `UTM-tagged visits · ${span} — the ${rows.length} most recent of ${utm.totalHits} hits.`
            : `Every UTM-tagged visit the site captured · ${span} — ${utm.totalHits} hits.`
        }
      />
      <UtmTracerChart
        data={utm}
        subtitle={`${span} · ${utm.totalHits} hits`}
        controls={
          <UtmRangePicker
            from={toRangeParam(from)}
            to={toRangeParam(to)}
            today={toRangeParam(today)}
          />
        }
      />
      <TrackerTable
        rows={rows.map((r) => ({
          id: r.id,
          source: r.source,
          medium: r.medium,
          campaign: r.campaign,
          content: r.content,
          term: r.term,
          messageId: r.messageId,
          path: r.path,
          referrer: r.referrer,
          userAgent: r.userAgent,
          visitedAt: r.visitedAt.toISOString(),
        }))}
      />
    </div>
  );
}
