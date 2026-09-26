import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import UtmTracerChart from "@/components/utm-tracer-chart";
import UtmRangePicker from "@/components/utm-range-picker";
import {
  DEFAULT_TRACKER_DAYS, UTM_TAGGED, getUtmSeriesForRange, parseRangeParam, toRangeParam,
} from "@/lib/utm";
import { TrackerTable } from "./table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROW_CAP = 2000;
// mirrors the cap inside @/lib/utm
const MAX_RANGE_DAYS = 366;

function localDay(d: Date, offset = 0) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const today = localDay(new Date());
  let to = parseRangeParam(one(sp.to)) ?? today;
  let from = parseRangeParam(one(sp.from)) ?? localDay(to, -(DEFAULT_TRACKER_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  if (Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1 > MAX_RANGE_DAYS) {
    from = localDay(to, -(MAX_RANGE_DAYS - 1));
  }

  const [utm, rows] = await Promise.all([
    getUtmSeriesForRange({ from, to }),
    prisma.analyticsSession.findMany({
      where: { ...UTM_TAGGED, startedAt: { gte: from, lt: localDay(to, 1) } },
      orderBy: { startedAt: "desc" },
      take: ROW_CAP,
      select: {
        id: true, rawSource: true, rawMedium: true, rawCampaign: true, rawContent: true,
        rawTerm: true, messageId: true, landingPath: true, referrerHost: true,
        deviceType: true, browser: true, startedAt: true,
      },
    }),
  ]);

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
            ? `UTM-tagged sessions · ${span} — the ${rows.length} most recent of ${utm.totalHits}. Attribution is read once, when the session opens, and sessions are pruned after 90 days.`
            : `Every UTM-tagged session still on record · ${span} — ${utm.totalHits}. Attribution is read once, when the session opens, and sessions are pruned after 90 days.`
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
          source: r.rawSource,
          medium: r.rawMedium,
          campaign: r.rawCampaign,
          content: r.rawContent,
          term: r.rawTerm,
          messageId: r.messageId,
          path: r.landingPath,
          referrerHost: r.referrerHost,
          deviceType: r.deviceType,
          browser: r.browser,
          visitedAt: r.startedAt.toISOString(),
        }))}
      />
    </div>
  );
}
