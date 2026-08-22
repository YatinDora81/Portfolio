import { redirect } from "next/navigation";
import { catchUpRollups } from "db/rollup";
import { logger } from "@repo/shared/logger";
import { toDateKey, utcDayStart } from "@repo/shared/dates";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { longDayLabel, readAnalytics, WINDOWS, type WindowDays } from "@/lib/analytics-read";
import { SectionPanels, SummaryStatus, WindowPicker } from "./parts";
import { ChannelChart, ChannelLegend, TrafficChart, TrafficLegend } from "./charts";
import {
  IconActivity, IconChartArea, IconDatabase, IconDeviceMobile, IconRoute, IconUsers,
} from "@tabler/icons-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_MS = 86_400_000;

function parseWindow(v: string | string[] | undefined): WindowDays {
  const raw = Array.isArray(v) ? v[0] : v;
  const n = Number(raw);
  return WINDOWS.find((w) => w === n) ?? 30;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const days = parseWindow((await searchParams).days);

  // Opening the page is the fallback scheduler; a rollup failure must not take the page with it.
  let caughtUp = { processed: 0, remaining: 0, error: null as string | null };
  try {
    const res = await catchUpRollups();
    caughtUp = { processed: res.processed.length, remaining: res.remaining, error: null };
  } catch (e) {
    caughtUp = { processed: 0, remaining: 0, error: String(e) };
    logger.error("analytics", "catch-up on page load failed", { err: String(e) });
  }

  const view = await readAnalytics(days);

  // Only the analytics tables: RateLimitBucket also fills from the contact form.
  const analyticsTables = new Set(["AnalyticsSession", "AnalyticsEvent", "DailyStat", "RollupRun"]);
  const rowsAnywhere = view.counts.some((c) => analyticsTables.has(c.table) && c.rows > 0);
  const hasTraffic = view.visits > 0 || view.sessions > 0;

  const todayStart = utcDayStart(new Date());
  const yesterdayKey = toDateKey(new Date(todayStart.getTime() - DAY_MS));
  const nextUnsummarized = view.summarizedThroughKey
    ? toDateKey(new Date(new Date(`${view.summarizedThroughKey}T00:00:00.000Z`).getTime() + DAY_MS))
    : view.fromKey;
  // With nothing collected, pre-filling the window start would aim at a fortnight of empty days.
  const suggestedFrom =
    !rowsAnywhere || nextUnsummarized > yesterdayKey ? yesterdayKey : nextUnsummarized;

  return (
    <div className="view wide">
      <PageHeader
        eyebrow="traffic · sessions & sections"
        title="Analytics"
        description="Completed days are read from the daily rollup; today is counted live from the raw tables, because it is not finished yet. Every figure says which of the two it came from."
      >
        <WindowPicker days={days} options={WINDOWS} />
      </PageHeader>

      {!rowsAnywhere ? (
        <div className="rv-banner">
          <i><IconActivity size={17} stroke={1.6} /></i>
          <div>
            <b>No analytics collected yet</b>
            The four analytics tables hold no rows — no sessions, no events, no summarized days —
            so every figure on this page is an absence rather than a measurement. Counts still
            showing in the table below belong elsewhere: UTM capture and the contact form&apos;s
            rate limiter write there too. This is the expected state until the public site serves a
            visitor who is not a bot: the beacon at <code>/api/collect</code> writes the first
            session, section dwell follows once someone scrolls, and the rollup turns yesterday
            into DailyStat rows the next time any page loads. Nothing here is broken, and nothing
            needs pressing. If traffic is arriving and this stays empty, check the{" "}
            <code>analytics</code> feature flag first.
          </div>
        </div>
      ) : null}

      <SummaryStatus
        summarizedThrough={view.summarizedThroughKey ? longDayLabel(view.summarizedThroughKey) : null}
        daysBehind={view.daysBehind}
        gapDays={view.gapDays}
        windowDays={days}
        caughtUp={caughtUp}
        suggestedFrom={suggestedFrom}
        suggestedTo={yesterdayKey}
      />


      <div className="stat-grid">
        <div className="stat">
          <div className="stat-k"><IconChartArea size={11} /> visits · {days}d</div>
          <div className="stat-v">{view.visits}</div>
          <div className="stat-m">
            Pageviews, summed. <i>Not unique visitors</i> — the salt rotates every day, so someone
            who came Monday and Tuesday is two visits here and there is no way to know otherwise.
          </div>
        </div>

        <div className="stat">
          <div className="stat-k"><IconRoute size={11} /> sessions · {days}d</div>
          <div className="stat-v">{view.sessions}</div>
          <div className="stat-m">
            {!rowsAnywhere
              ? "nothing collected yet"
              : view.gapDays > 0
                ? <i>{view.gapDays} day{view.gapDays === 1 ? "" : "s"} missing</i>
                : "summed across the window"}
          </div>
        </div>

        <div className="stat">
          <div className="stat-k"><IconUsers size={11} /> unique · today</div>
          <div className="stat-v">{view.uniquesToday}</div>
          <div className="stat-m">
            {view.sessionsToday} session{view.sessionsToday === 1 ? "" : "s"} · the only window a
            unique count is honest in
          </div>
        </div>

        <div className="stat">
          <div className="stat-k"><IconUsers size={11} /> best day · uniques</div>
          <div className="stat-v">{view.peakUniques?.uniques ?? "—"}</div>
          <div className="stat-m">
            {view.peakUniques ? `on ${view.peakUniques.day}` : "no day has a unique count yet"}
          </div>
        </div>
      </div>

      <Card flush className="rv-card">
        <CardHead
          title="Traffic"
          right={hasTraffic ? <TrafficLegend /> : undefined}
        />
        {hasTraffic ? (
          <TrafficChart timeline={view.timeline} />
        ) : (
          <div className="utm-empty">
            Nothing to plot — no pageviews or sessions in the last {days} days.
          </div>
        )}
      </Card>


      <Card flush className="rv-card">
        <CardHead
          title="Channels"
          count={view.channels.totals.length}
          right={view.channels.series.length > 0 ? <ChannelLegend channels={view.channels} /> : undefined}
        />
        <div className="an-blurb">
          Where sessions came from, resolved once when the session was created and never rewritten
          — an internal click cannot relabel a visitor&apos;s source.
          {view.channels.hidden > 0
            ? ` The chart plots the four largest; the other ${view.channels.hidden} are in the table below.`
            : ""}
        </div>
        {view.channels.series.length > 0 ? (
          <ChannelChart channels={view.channels} />
        ) : (
          <div className="utm-empty">No session has been attributed to a channel yet.</div>
        )}
        {view.channels.totals.length > 0 ? (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr><th>Channel</th><th>Sessions</th><th>Share</th><th /></tr>
              </thead>
              <tbody>
                {view.channels.totals.map((t) => (
                  <tr key={t.channel}>
                    <td><span className="chip">{t.channel}</span></td>
                    <td className="rv-mono">{t.sessions}</td>
                    <td className="rv-mono">{t.share.toFixed(1)}%</td>
                    <td style={{ width: "45%" }}>
                      <span className="an-ft"><span style={{ width: `${t.share}%` }} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>


      <div className="an-note">
        <IconDeviceMobile size={13} stroke={1.6} />
        Desktop and mobile are expected to diverge here: much of the public site is hover-driven,
        and hover does not exist on touch. If the mobile funnel falls off a cliff where desktop
        does not, that is the fastest signal you will get that the mobile experience is failing.
      </div>

      <SectionPanels sections={view.sections} hasData={view.hasSectionData} windowDays={days} />


      <Card flush className="rv-card">
        <CardHead title="Raw rows" count={view.counts.length} />
        <div className="an-blurb">
          What is physically in the database, so growth is visible and it is obvious when the
          rollup starts earning its keep — that is the day AnalyticsEvent keeps climbing and the
          panels above stop needing it.
          <div className="an-dims">
            {view.dimensionsSeen.length === 0 ? (
              <span className="an-none-inline">DailyStat holds no dimensions yet</span>
            ) : (
              view.dimensionsSeen.map((d) => (
                <span className="chip" key={d.dimension}>{d.dimension} · {d.rows}</span>
              ))
            )}
          </div>
          {view.dimensionsSeen.length === 0
            ? "Nothing has been summarized, so there is no dimension to check yet."
            : "These are the dimensions the rollup actually wrote. If a panel above is empty while these rows exist, a dimension name is the first thing to check."}
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr><th>Table</th><th>Rows</th><th>What it holds</th></tr>
            </thead>
            <tbody>
              {view.counts.map((c) => (
                <tr key={c.table}>
                  <td className="rv-mono">{c.table}</td>
                  <td className="rv-mono">{c.rows}</td>
                  <td style={{ color: "var(--faint)", fontSize: 12 }}>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card flush className="rv-card">
        <CardHead title="Rollup runs" count={view.runs.length} />
        {view.runs.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconDatabase size={18} stroke={1.5} /></div>
            <b>No run recorded</b>
            <span>Each summarized day writes one row here, with what it cost and what it said when it failed.</span>
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl" style={{ minWidth: 780 }}>
              <thead>
                <tr><th>Day</th><th>Ran at</th><th>Status</th><th>Rows</th><th>Took</th><th>Trigger</th><th>Error</th></tr>
              </thead>
              <tbody>
                {view.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="rv-mono rv-nowrap">{r.day}</td>
                    <td className="rv-mono rv-nowrap" style={{ color: "var(--dim)" }}>{r.at}</td>
                    <td>
                      <Badge
                        variant={r.status === "ok" ? "success" : r.status === "skipped" ? "outline" : "warning"}
                        dot={r.status !== "skipped"}
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="rv-mono">{r.rowsWritten}</td>
                    <td className="rv-mono">{r.durationMs} ms</td>
                    <td className="rv-mono" style={{ color: "var(--faint)" }}>{r.triggeredBy}</td>
                    <td>{r.error ? <span className="rv-err">{r.error}</span> : <span className="rv-none">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.maintenance.length > 0 ? (
          <div className="an-body">
            <div className="hint">
              Maintenance:{" "}
              {view.maintenance.map((m) => `${m.key} — ${m.lastRunAt}${m.lastResult ? ` (${m.lastResult})` : ""}`).join(" · ")}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
