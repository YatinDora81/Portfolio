import { prisma } from "db";
import { redirect } from "next/navigation";
import { ALL_KNOWN_TAGS } from "@repo/shared/tags";
import { PageHeader } from "@/components/shared/page-header";
import { getSession } from "@/lib/session";
import { readHealth, readRecentLogs, readTagStates } from "@/lib/revalidation";
import { findStaleContent } from "@/lib/stale";
import { IconActivity, IconAlertTriangle, IconClockPause, IconGauge, IconChecks } from "@tabler/icons-react";
import { ManualControls, RecentLog, StaleContent } from "./parts";

// Every number here is a live count of something that just happened. A cached
// render would show the health summary from *before* the failure it exists to
// warn about — the one state in which this page is worse than nothing.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEALTH_DAYS = 7;
const LOG_CAP = 100;

/** Below this, the summary turns red rather than merely reporting a number. */
const HEALTHY_RATE = 0.95;

/**
 * The DB stores UTC; the only person reading this page reads IST. The formatting
 * happens HERE, on the server, with the zone named explicitly — a
 * `toLocaleString()` inside the client components would use the server's zone
 * during SSR and the browser's on hydration, which is precisely the text
 * mismatch React tears the tree down over. Naming the zone makes both passes
 * emit the same characters, so no "format after mount" dance is needed and
 * nothing flashes.
 */
const IST = "Asia/Kolkata";
const stampFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST, day: "2-digit", month: "short", hourCycle: "h23",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST, day: "2-digit", month: "short", year: "numeric", hourCycle: "h23",
  hour: "2-digit", minute: "2-digit",
});

const stamp = (d: Date) => `${stampFmt.format(d)} IST`;
const day = (d: Date) => `${dayFmt.format(d)} IST`;

export default async function RevalidationPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [health, stale, logs, tagStates] = await Promise.all([
    readHealth(HEALTH_DAYS),
    findStaleContent(),
    readRecentLogs(LOG_CAP),
    readTagStates(),
  ]);

  // One query over the distinct ids actually present, not a join: `actorId` is a
  // plain String precisely so hard-deleting an admin cannot take the log with
  // it, which means some ids here resolve to nobody. Those render as the raw id.
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => id !== null))];
  const admins = actorIds.length > 0
    ? await prisma.adminUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actors: Record<string, string> = {};
  for (const a of admins) actors[a.id] = a.name;

  const stateByTag = new Map(tagStates.map((s) => [s.tag, s]));
  // The buttons come from ALL_KNOWN_TAGS, never from the TagState rows: a tag
  // that has never been flushed has no row, and that is exactly the tag whose
  // button you most need.
  const tagRows = ALL_KNOWN_TAGS.map((tag) => {
    const s = stateByTag.get(tag);
    // A tag whose first attempt failed is seeded with the epoch, deliberately,
    // so the staleness comparison treats it as never fresh. Printing that date
    // would tell the reader this tag was flushed in 1970; it means "not once".
    const succeeded = s !== undefined && s.lastSuccessAt.getTime() > 0;
    return {
      tag,
      lastSuccessAt: succeeded ? day(s.lastSuccessAt) : null,
      fails: s?.consecutiveFails ?? 0,
    };
  });

  const silent = health.total === 0;
  const degraded = !silent && health.successRate < HEALTHY_RATE;
  const missed = health.failed + health.timeout;
  const pct = `${(health.successRate * 100).toFixed(1)}%`;

  return (
    <div className="view">
      <PageHeader
        eyebrow="operations · cache health"
        title="Revalidation"
        description="Every attempt to flush the public site's cache, what it cost and what it said when it failed. Edits that never reached the site show up here before a visitor finds them."
      />

      {silent ? (
        <div className="rv-banner">
          <i><IconClockPause size={17} stroke={1.6} /></i>
          <div>
            <b>Nothing recorded yet</b>
            No revalidation has been attempted in the last {HEALTH_DAYS} days. That is not a
            failure — the log starts filling the first time a save, a publish or one of the
            buttons below reaches the public app.
          </div>
        </div>
      ) : degraded ? (
        <div className="rv-banner bad">
          <i><IconAlertTriangle size={17} stroke={1.7} /></i>
          <div>
            <b>{missed} of {health.total} attempts never landed</b>
            Success is at {pct} over the last {HEALTH_DAYS} days, under the{" "}
            {HEALTHY_RATE * 100}% this page treats as healthy. Anything edited inside a failed
            window is still serving its old copy to visitors. Each failure carries its exact
            error in the log below.
          </div>
        </div>
      ) : null}

      <div className="stat-grid even">
        <div className="stat">
          <div className="stat-k"><IconActivity size={11} /> attempts · {HEALTH_DAYS}d</div>
          <div className="stat-v">{health.total}</div>
          <div className="stat-m">
            {silent
              ? "nothing has asked for a flush yet"
              : <>{health.success} landed · {health.failed} failed · {health.timeout} timed out</>}
          </div>
        </div>

        <div className="stat">
          <div className="stat-k"><IconChecks size={11} /> success rate</div>
          <div className="stat-v">{silent ? "—" : pct}</div>
          <div className="stat-m">
            {silent ? "no attempts to rate" : degraded
              ? <i>below the {HEALTHY_RATE * 100}% line</i>
              : <em>healthy</em>}
          </div>
        </div>

        <div className="stat">
          <div className="stat-k"><IconGauge size={11} /> p95 duration</div>
          <div className="stat-v">
            {silent ? "—" : health.p95DurationMs}
            {silent ? null : <span className="rv-unit">ms</span>}
          </div>
          <div className="stat-m">
            {silent ? "no attempts to time" : "19 in 20 finished inside this"}
          </div>
        </div>
      </div>

      <StaleContent
        items={stale.map((s) => ({
          id: s.id,
          type: s.type,
          slug: s.slug,
          title: s.title,
          editedAt: day(s.updatedAt),
          revalidatedAt: s.lastRevalidatedAt ? day(s.lastRevalidatedAt) : null,
        }))}
      />

      <ManualControls tags={tagRows} />

      <RecentLog
        rows={logs.map((l) => ({
          id: l.id,
          at: stamp(l.createdAt),
          trigger: l.trigger,
          paths: l.paths,
          tags: l.tags,
          status: l.status,
          httpStatus: l.httpStatus,
          durationMs: l.durationMs,
          actorId: l.actorId,
          error: l.error,
        }))}
        actors={actors}
        capped={logs.length === LOG_CAP}
      />
    </div>
  );
}
