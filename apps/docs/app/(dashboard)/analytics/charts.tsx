"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ChannelsView, DayPoint, SectionRow } from "@/lib/analytics-read";

/** The UTM tracer's ramp, so a chart here reads as a sibling of the one on /tracker. */
const COLORS = ["var(--ch1)", "var(--ch2)", "var(--ch3)", "var(--ch4)"];
const colorAt = (i: number) => COLORS[i] ?? "var(--dim)";

/** Keyed by position: a channel literally named "day" would shadow the x-axis dataKey. */
const slot = (i: number) => `s_${i}`;

const AXIS = {
  axisLine: false,
  tickLine: false,
  tick: { fill: "var(--faint)" },
} as const;

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

export function TrafficChart({ timeline }: { timeline: DayPoint[] }) {
  const rows = timeline.map((d) => ({
    day: d.label,
    visits: d.pageviews,
    sessions: d.sessions,
    state: d.isToday ? "today" : d.summarized ? "summarized" : "gap",
  }));

  function Tip({ active, label, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as (typeof rows)[number] | undefined;
    if (!row) return null;
    return (
      <div className="utm-tip">
        <div className="d">
          {label}
          {row.state === "today" ? " · today, still open" : row.state === "gap" ? " · not summarized" : ""}
        </div>
        <div className="r">
          <span><span className="lg-dot" style={{ background: colorAt(0) }} /> visits</span>
          <b>{row.visits ?? "—"}</b>
        </div>
        <div className="r">
          <span><span className="lg-dot" style={{ background: colorAt(1) }} /> sessions</span>
          <b>{row.sessions ?? "—"}</b>
        </div>
      </div>
    );
  }

  return (
    <div className="utm-wrap">
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={rows} margin={{ top: 14, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--gridc)" />
          <XAxis dataKey="day" interval="equidistantPreserveStart" minTickGap={14} tickMargin={8} {...AXIS} />
          <YAxis width={38} tickCount={5} allowDecimals={false} {...AXIS} />
          <Tooltip content={Tip} cursor={{ stroke: "var(--tickc)", strokeWidth: 1, strokeDasharray: "3 3" }} />
          {/* connectNulls off: an unsummarized day is a hole, not a straight line. */}
          <Area
            type="monotone" dataKey="visits" name="visits" connectNulls={false}
            stroke={colorAt(0)} strokeWidth={1.8} strokeLinecap="round"
            fill={colorAt(0)} fillOpacity={0.08} dot={false}
            activeDot={{ r: 3.2, strokeWidth: 1.5, stroke: "var(--card)" }}
          />
          <Area
            type="monotone" dataKey="sessions" name="sessions" connectNulls={false}
            stroke={colorAt(1)} strokeWidth={1.8} strokeLinecap="round"
            fill="none" fillOpacity={0} dot={false}
            activeDot={{ r: 3.2, strokeWidth: 1.5, stroke: "var(--card)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrafficLegend() {
  return (
    <div className="utm-legend">
      <span className="lg-it"><span className="lg-dot" style={{ background: colorAt(0) }} /> visits</span>
      <span className="lg-it"><span className="lg-dot" style={{ background: colorAt(1) }} /> sessions</span>
    </div>
  );
}

export function ChannelChart({ channels }: { channels: ChannelsView }) {
  const rows = channels.labels.map((day, i) => {
    const row: Record<string, string | number | null> = { day };
    channels.series.forEach((s, si) => { row[slot(si)] = s.values[i] ?? null; });
    return row;
  });

  function Tip({ active, label, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value]));
    return (
      <div className="utm-tip">
        <div className="d">{label}</div>
        {channels.series.map((s, i) => (
          <div className="r" key={s.id}>
            <span><span className="lg-dot" style={{ background: colorAt(i) }} /> {s.label}</span>
            <b>{byKey.get(slot(i)) ?? "—"}</b>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="utm-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={rows} margin={{ top: 14, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--gridc)" />
          <XAxis dataKey="day" interval="equidistantPreserveStart" minTickGap={14} tickMargin={8} {...AXIS} />
          <YAxis width={38} tickCount={5} allowDecimals={false} {...AXIS} />
          <Tooltip content={Tip} cursor={{ stroke: "var(--tickc)", strokeWidth: 1, strokeDasharray: "3 3" }} />
          {channels.series.map((s, i) => (
            <Area
              key={s.id}
              type="monotone" dataKey={slot(i)} name={s.label} connectNulls={false}
              stroke={colorAt(i)} strokeWidth={1.8} strokeLinecap="round"
              fill={i === 0 ? colorAt(0) : "none"} fillOpacity={i === 0 ? 0.08 : 0}
              dot={false}
              activeDot={{ r: 3.2, strokeWidth: 1.5, stroke: "var(--card)" }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChannelLegend({ channels }: { channels: ChannelsView }) {
  return (
    <div className="utm-legend">
      {channels.series.map((s, i) => (
        <span className="lg-it" key={s.id}>
          <span className="lg-dot" style={{ background: colorAt(i) }} /> {s.label}
        </span>
      ))}
    </div>
  );
}

type Metric = "dwell" | "density";

/** Two scales never share an axis, so these are two charts behind one switch. */
export function SectionBars({ rows, metric }: { rows: SectionRow[]; metric: Metric }) {
  const data = rows.map((r) => ({
    section: r.label,
    value: metric === "dwell" ? r.medianMs : r.msPer100px,
    heightPx: r.heightPx,
    reached: r.reached,
  }));

  function Tip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as (typeof data)[number] | undefined;
    if (!row) return null;
    return (
      <div className="utm-tip">
        <div className="d">{row.section}</div>
        <div className="r">
          <span>{metric === "dwell" ? "median dwell" : "per 100px"}</span>
          <b>{row.value === null ? "—" : ms(row.value)}</b>
        </div>
        <div className="r"><span>section height</span><b>{row.heightPx}px</b></div>
        <div className="r"><span>visits measured</span><b>{row.reached}</b></div>
      </div>
    );
  }

  return (
    <div className="utm-wrap">
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} margin={{ top: 14, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--gridc)" />
          <XAxis dataKey="section" interval={0} minTickGap={2} tickMargin={8} {...AXIS} />
          <YAxis width={48} tickCount={4} tickFormatter={ms} {...AXIS} />
          <Tooltip content={Tip} cursor={{ fill: "var(--bg2)" }} />
          <Bar
            dataKey="value"
            fill={metric === "dwell" ? "var(--ch1)" : "var(--ch3)"}
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
