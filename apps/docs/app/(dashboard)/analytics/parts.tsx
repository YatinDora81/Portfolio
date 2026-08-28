"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { resummarize, runCatchUp, runMaintenanceNow } from "@/lib/actions/analytics";
import type { SectionRow, Split } from "@/lib/analytics-read";
import { SectionBars } from "./charts";
import {
  IconAlertTriangle, IconArrowDown, IconEraser, IconCircleCheck, IconPlayerPlay,
  IconRefresh, IconStack2,
} from "@tabler/icons-react";

const SPLIT_ORDER: Split[] = ["all", "desktop", "mobile", "tablet"];
const SPLIT_LABEL: Record<Split, string> = {
  all: "All", desktop: "Desktop", mobile: "Mobile", tablet: "Tablet",
};

const splitPhrase = (s: Split) => (s === "all" ? "any device" : SPLIT_LABEL[s].toLowerCase());

const PRESET_STYLE: React.CSSProperties = { padding: "5px 10px", fontSize: 12 };

const DAY_MS = 86_400_000;

// mirrors MAX_RANGE_DAYS in the server module
const MAX_RUN_DAYS = 14;

const dayTime = (key: string) => Date.parse(`${key}T00:00:00.000Z`);

function shiftDay(key: string, days: number): string | null {
  const t = dayTime(key);
  return Number.isNaN(t) ? null : new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

function rangeDays(from: string, to: string): number | null {
  const a = dayTime(from);
  const b = dayTime(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / DAY_MS + 1;
}

function clampKey(value: string, lo: string | null, hi: string | null): string {
  if (lo !== null && value < lo) return lo;
  if (hi !== null && value > hi) return hi;
  return value;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// a throw inside a transition reaches no error boundary
function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function ms(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

type Outcome = { ok: true; text: string } | { ok: false; text: string };

function Result({ outcome }: { outcome: Outcome }) {
  if (outcome.ok) {
    return (
      <div className="rv-ok">
        <IconCircleCheck size={12} stroke={1.8} /> {outcome.text}
      </div>
    );
  }
  return <div className="rv-err">{outcome.text}</div>;
}

export interface StatusProps {
  summarizedThrough: string | null;
  daysBehind: number;
  gapDays: number;
  windowDays: number;
  caughtUp: { processed: number; remaining: number; error: string | null };
  suggestedFrom: string;
  suggestedTo: string;
}

export function SummaryStatus(props: StatusProps) {
  const router = useRouter();
  const [from, setFrom] = useState(props.suggestedFrom);
  const [to, setTo] = useState(() =>
    clampKey(props.suggestedTo, null, shiftDay(props.suggestedFrom, MAX_RUN_DAYS - 1)),
  );
  const [busy, setBusy] = useState<"run" | "catchup" | "maint" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [, start] = useTransition();

  const behind = props.summarizedThrough === null || props.daysBehind > 0;
  const span = rangeDays(from, to);

  const pickFrom = (next: string) => {
    const capped = clampKey(next, null, props.suggestedTo);
    setFrom(capped);
    const ceiling = shiftDay(capped, MAX_RUN_DAYS - 1);
    if (ceiling === null) return;
    setTo((current) => clampKey(current, capped, clampKey(ceiling, null, props.suggestedTo)));
  };

  const pickTo = (next: string) => {
    const capped = clampKey(next, null, props.suggestedTo);
    setTo(capped);
    const floor = shiftDay(capped, -(MAX_RUN_DAYS - 1));
    if (floor === null) return;
    setFrom((current) => clampKey(current, floor, capped));
  };

  const run = (key: "run" | "catchup" | "maint", call: () => Promise<Outcome>) => {
    setBusy(key);
    setOutcome(null);
    start(async () => {
      try {
        const next = await call();
        setOutcome(next);
        if (next.ok) router.refresh();
      } catch (e) {
        setOutcome({ ok: false, text: transportError(e) });
      } finally {
        setBusy(null);
      }
    });
  };

  const doResummarize = () =>
    run("run", async () => {
      const res = await resummarize({ from, to });
      const attempted = res.results.length;
      if (attempted === 0) {
        return { ok: false as const, text: res.error ?? "The re-summarize did not run." };
      }

      const failed = res.results.filter((r) => !r.ok);
      const left = res.remaining > 0 ? ` · ${plural(res.remaining, "day")} still to go — run it again` : "";

      if (failed.length > 0) {
        const first = failed[0];
        return {
          ok: false as const,
          text: `${plural(attempted - failed.length, "day")} summarized, ${failed.length} failed${left}${
            first?.error ? ` — ${first.date}: ${first.error}` : ""
          }`,
        };
      }

      const last = res.results[attempted - 1];
      const resume = res.remaining > 0 && last ? shiftDay(last.date, 1) : null;
      if (resume !== null) setFrom(resume);

      return { ok: true as const, text: `re-summarized ${plural(attempted, "day")}${left}` };
    });

  const doCatchUp = () =>
    run("catchup", async () => {
      const res = await runCatchUp();
      if (!res.ok) return { ok: false as const, text: res.error ?? "The catch-up did not run." };
      return {
        ok: true as const,
        text: `summarized ${plural(res.processed.length, "day")} · ${res.remaining} still queued`,
      };
    });

  const doMaintenance = () =>
    run("maint", async () => {
      const res = await runMaintenanceNow();
      return res.ok
        ? { ok: true as const, text: "maintenance ran — old salts and spent rate-limit windows pruned" }
        : { ok: false as const, text: res.error ?? "Maintenance did not run." };
    });

  return (
    <Card flush className="rv-card">
      <CardHead
        title="Summarization"
        right={
          behind ? (
            <Badge variant="warning" dot>
              {props.summarizedThrough === null ? "never run" : `${props.daysBehind}d behind`}
            </Badge>
          ) : (
            <Badge variant="success" dot>up to date</Badge>
          )
        }
      />

      <div className="an-status">
        <div className="an-status-line">
          {props.summarizedThrough === null ? (
            <>
              <b>Nothing summarized yet.</b> DailyStat is empty, so every figure below either
              comes from today&apos;s raw rows or is blank.
            </>
          ) : (
            <>
              <b>Summarized through {props.summarizedThrough}.</b>{" "}
              {props.daysBehind === 0
                ? "Every completed day is in DailyStat; only today is still being counted live."
                : `${props.daysBehind} completed day${props.daysBehind === 1 ? " is" : "s are"} not summarized yet — that gap is missing from every window below.`}
            </>
          )}
        </div>

        <div className="an-status-line dim">
          {props.caughtUp.error
            ? <><IconAlertTriangle size={12} stroke={1.7} /> This page&apos;s own catch-up failed: {props.caughtUp.error}</>
            : props.caughtUp.remaining > 0
              ? <>Catching up — {props.caughtUp.processed} summarized on this load, {props.caughtUp.remaining} day{props.caughtUp.remaining === 1 ? "" : "s"} remaining. Reload to continue; there is no scheduler, so page loads are the clock.</>
              : props.caughtUp.processed > 0
                ? <>Caught up on this load: {props.caughtUp.processed} day{props.caughtUp.processed === 1 ? "" : "s"} summarized.</>
                : <>Nothing to catch up on this load.</>}
        </div>

        {props.gapDays > 0 && props.summarizedThrough !== null ? (
          <div className="an-status-line dim">
            {props.gapDays} of the last {props.windowDays} days{" "}
            {props.gapDays === 1 ? "has" : "have"} no DailyStat row, and{" "}
            {props.gapDays === 1 ? "shows" : "show"} as a break in the chart rather than a zero.
          </div>
        ) : null}

        <div className="an-controls">
          <div className="utm-range">
            <input
              type="date" className="in" aria-label="Re-summarize from" value={from}
              min={shiftDay(to, -(MAX_RUN_DAYS - 1)) ?? undefined} max={to || props.suggestedTo}
              disabled={busy !== null} onChange={(e) => pickFrom(e.target.value)}
            />
            <span aria-hidden style={{ color: "var(--faint)", fontSize: 11 }}>→</span>
            <input
              type="date" className="in" aria-label="Re-summarize to" value={to}
              min={from || undefined}
              max={clampKey(shiftDay(from, MAX_RUN_DAYS - 1) ?? props.suggestedTo, null, props.suggestedTo)}
              disabled={busy !== null} onChange={(e) => pickTo(e.target.value)}
            />
            <Button
              variant="outline" style={PRESET_STYLE}
              disabled={busy !== null || span === null} onClick={doResummarize}
            >
              {busy === "run" ? <IconRefresh size={13} className="spin" /> : <IconPlayerPlay size={13} stroke={1.7} />}
              Re-summarize
            </Button>
          </div>

          <span className="an-sp" />

          <Button variant="ghost" style={PRESET_STYLE} disabled={busy !== null} onClick={doCatchUp}>
            {busy === "catchup" ? <IconRefresh size={13} className="spin" /> : <IconStack2 size={13} stroke={1.6} />}
            Catch up now
          </Button>
          <Button variant="ghost" style={PRESET_STYLE} disabled={busy !== null} onClick={doMaintenance}>
            {busy === "maint" ? <IconRefresh size={13} className="spin" /> : <IconEraser size={13} stroke={1.6} />}
            Run maintenance
          </Button>
        </div>

        {span === null ? (
          <div className="an-status-line dim">
            <IconAlertTriangle size={12} stroke={1.7} /> Pick both dates to re-summarize a range.
          </div>
        ) : null}

        <div className="an-status-line faint">
          Re-summarizing a range is safe to repeat — DailyStat is unique on (date, dimension, key),
          so a second run overwrites rather than doubles. Dates are UTC days, the same key the
          rollup writes. The picker stops at yesterday and at {MAX_RUN_DAYS} days, which is as far
          as one press reaches; a slow run stops sooner still, and the range moves up so the next
          press carries on from there. Catch up now is the tool for a longer backlog.
        </div>

        {outcome ? <Result outcome={outcome} /> : null}
      </div>
    </Card>
  );
}

export function WindowPicker({ days, options }: { days: number; options: readonly number[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, start] = useTransition();

  const pick = (next: number) => {
    if (next === days) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", String(next));
    start(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  return (
    <div className="utm-range">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          className={`btn ${n === days ? "pri" : "ghost"}`}
          style={PRESET_STYLE}
          aria-pressed={n === days}
          onClick={() => pick(n)}
        >
          {n}d
        </button>
      ))}
    </div>
  );
}

export interface SectionPanelsProps {
  sections: Record<Split, SectionRow[]>;
  hasData: Record<Split, boolean>;
  windowDays: number;
}

function SplitSwitch({
  split, setSplit, hasData, anyData,
}: {
  split: Split;
  setSplit: (s: Split) => void;
  hasData: Record<Split, boolean>;
  anyData: boolean;
}) {
  return (
    <div className="an-split" role="group" aria-label="Split by device">
      {SPLIT_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          className={`an-split-b ${s === split ? "on" : ""}`}
          aria-pressed={s === split}
          onClick={() => setSplit(s)}
        >
          {SPLIT_LABEL[s]}
          {anyData && !hasData[s] && s !== "all" ? <span className="an-split-z">0</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SectionPanels({ sections, hasData, windowDays }: SectionPanelsProps) {
  const [split, setSplit] = useState<Split>("all");
  const rows = sections[split];
  const hasDwell = rows.some((r) => r.medianMs !== null);
  const anyData = SPLIT_ORDER.some((s) => hasData[s]);
  const arrival = rows[rows.length - 1]?.reachPct ?? null;

  const switchEl = <SplitSwitch split={split} setSplit={setSplit} hasData={hasData} anyData={anyData} />;

  const source =
    split === "all" ? (
      <>Completed days from the daily rollup, today from the raw tables.</>
    ) : (
      <>
        <b>{SPLIT_LABEL[split]} is read from raw events, not the rollup</b> — DailyStat summarizes
        sections and devices separately and never crosses them, so this split only reaches back as
        far as event retention. It will not line up exactly with <em>All</em> on a window older
        than that.
      </>
    );

  return (
    <>
      <Card flush className="rv-card">
        <CardHead title="Reach funnel" right={switchEl} />
        <div className="an-blurb">
          Share of sessions that reached each section, in the order a visitor scrolls them. The
          drop between two rows is the cost of the row above — too long, or reading as an ending.
          {arrival !== null
            ? ` Over ${windowDays} days, ${arrival.toFixed(0)}% of ${SPLIT_LABEL[split].toLowerCase()} sessions got from the hero to the contact form.`
            : ""}
          {" "}{source}
        </div>
        <div className="an-body">
          <Funnel rows={rows} split={split} anyData={anyData} />
        </div>
      </Card>

      <Card flush className="rv-card">
        <CardHead title="Median dwell per section" right={switchEl} />
        <div className="an-blurb">
          Median, never mean — one tab left open on a second monitor moves an average and does
          not move this.{" "}
          {split === "all"
            ? "All comes from the rollup: every completed day contributes the median it stored, weighted by the visits that day measured. Each stored median is per visit — a visit's flushes are summed before the percentile is taken, so someone who tabbed away and came back counts once, not twice — but a median of daily medians still only sits near the median across the whole window rather than being it."
            : `${SPLIT_LABEL[split]} skips the rollup and reads the raw events, where a visit's flushes are summed before the median is taken — someone who tabbed away and came back counts once, not twice. That makes it a true median per visit over the events still held, which is not the same as every visit in the window: this split only reaches back as far as event retention, so on a longer window it will not reconcile with All.`}
        </div>
        {hasDwell ? (
          <SectionBars rows={rows} metric="dwell" />
        ) : (
          <div className="an-body">
            <div className="an-none">
              {anyData
                ? `No dwell measured for ${splitPhrase(split)} yet.`
                : "Nothing collected yet — dwell is measured once a visitor scrolls the page."}
            </div>
          </div>
        )}
      </Card>

      <Card flush className="rv-card">
        <CardHead title="Attention ratio" right={switchEl} />
        <div className="an-blurb">
          Median dwell divided by the section&apos;s height, as milliseconds per 100 pixels. A tall
          section accumulates time simply by taking longer to scroll past; dividing by height
          shows the attention it actually earned. Heights are approximate and were measured once
          on a 1440×900 desktop viewport, so treat this as a ranking between sections rather
          than an absolute figure.
        </div>
        {hasDwell ? (
          <>
            <SectionBars rows={rows} metric="density" />
            <AttentionTable rows={rows} />
          </>
        ) : (
          <div className="an-body">
            <div className="an-none">
              {anyData
                ? `No dwell measured for ${splitPhrase(split)} yet, so there is nothing to divide.`
                : "Nothing collected yet — the ratio needs a dwell measurement and a height, and only the height exists so far."}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function Funnel({ rows, split, anyData }: { rows: SectionRow[]; split: Split; anyData: boolean }) {
  const measured = rows.some((r) => r.reached > 0);
  if (!measured) {
    return (
      <div className="an-none">
        {anyData
          ? `No section was reached by a ${split === "all" ? "" : `${SPLIT_LABEL[split].toLowerCase()} `}session in this window.`
          : "Nothing collected yet — no session has been recorded, so there is no funnel to draw and no percentage to read."}{" "}
        Dwell events arrive once a visitor actually scrolls the page.
      </div>
    );
  }

  return (
    <div className="an-funnel">
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1] : undefined;
        const drop =
          prev && prev.reachPct !== null && r.reachPct !== null ? prev.reachPct - r.reachPct : null;
        return (
          <div className="an-frow" key={r.id}>
            <span className="an-fk">{r.label}</span>
            <span className="an-ft">
              <span style={{ width: `${r.reachPct ?? 0}%` }} />
            </span>
            <span className="an-fn">{r.reachPct === null ? "—" : `${r.reachPct.toFixed(0)}%`}</span>
            <span className="an-fc">{r.reached} of {r.sessions}</span>
            <span className={`an-fd ${drop !== null && drop >= 20 ? "bad" : ""}`}>
              {drop === null || drop <= 0 ? "" : <><IconArrowDown size={10} stroke={2} />{drop.toFixed(0)} pts</>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AttentionTable({ rows }: { rows: SectionRow[] }) {
  const order = [...rows]
    .filter((r) => r.msPer100px !== null)
    .sort((a, b) => (b.msPer100px ?? 0) - (a.msPer100px ?? 0))
    .map((r) => r.id);

  return (
    <div className="tbl-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Section</th>
            <th>Median dwell</th>
            <th>Height</th>
            <th>Per 100px</th>
            <th>Rank</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rank = order.indexOf(r.id);
            return (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td className="rv-mono">{ms(r.medianMs)}</td>
                <td className="rv-mono" style={{ color: "var(--faint)" }}>{r.heightPx}px</td>
                <td className="rv-mono">{ms(r.msPer100px)}</td>
                <td className="rv-mono" style={{ color: "var(--faint)" }}>
                  {rank === -1 ? "—" : `#${rank + 1}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
