"use client";

import {
  ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { UtmSeries } from "@/lib/utm";

/**
 * Dedicated categorical ramp, defined once in the light `:root` and shared by every
 * theme on purpose: hue encodes the *source*, so a series keeps its identity across a
 * theme switch, and `--good`/`--amber` stay reserved for status. Everything else here
 * (grid, axes, crosshair, tooltip, surface) still re-skins per theme.
 */
const COLORS = ["var(--ch1)", "var(--ch2)", "var(--ch3)", "var(--ch4)"];

/**
 * Recharts dataKeys index straight into each row object, so a source literally
 * named "day" would shadow the x-axis key (and "constructor" would be worse).
 * Keying by position is unique by construction; `label` carries the real name.
 */
const slot = (i: number) => `s_${i}`;

const colorAt = (i: number) => COLORS[i] ?? "var(--dim)";

type Props = {
  data: UtmSeries;
  title?: string;
  subtitle?: string;
  /** Rendered in `.card-h` between the subtitle and the legend (e.g. the range picker). */
  controls?: React.ReactNode;
  className?: string;
};

export default function UtmTracerChart({ data, title, subtitle, controls, className }: Props) {
  const n = data.days.length;

  const rows = data.days.map((day, i) => {
    const row: Record<string, string | number> = { day };
    data.series.forEach((s, si) => { row[slot(si)] = s.vals[i] ?? 0; });
    return row;
  });

  /** Rendered off our own series list, so every source shows up in legend order
      with an explicit 0 — recharts' own ordering and null-filtering don't apply. */
  function Tip({ active, label, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value]));
    return (
      <div className="utm-tip">
        <div className="d">{label}</div>
        {data.series.map((s, i) => (
          <div className="r" key={s.id}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="lg-dot" style={{ background: colorAt(i) }} />
              {s.label}
            </span>
            <b>{Number(byKey.get(slot(i)) ?? 0)}</b>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className ? `card ${className}` : "card"} style={{ marginBottom: 14 }}>
      {/* `.card-h` is a nowrap flex row; with controls in it the strip has to be able to
          break onto a second line rather than push the legend off a narrow viewport. */}
      <div className="card-h" style={{ flexWrap: "wrap" }}>
        <span className="card-t">{title ?? "UTM Tracer"}</span>
        <span className="card-n">{subtitle ?? `last ${n} days · ${data.totalHits} hits`}</span>
        {controls}
        <div className="utm-legend">
          {data.series.map((s, i) => (
            <span className="lg-it" key={s.id}>
              <span className="lg-dot" style={{ background: colorAt(i) }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {data.series.length === 0 ? (
        <div className="utm-empty">
          No UTM-tagged visits {subtitle ? "in this range" : `in the last ${n} days`}.
        </div>
      ) : (
        <div className="utm-wrap">
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={rows} margin={{ top: 14, right: 14, bottom: 6, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--gridc)" />
              {/* Measured, not counted: a *numeric* `interval` makes recharts skip
                  collision detection entirely, so a fixed ~10 labels that fit on a
                  desktop card overlap at 390px — and doubly so once a year-straddling
                  range widens every label to "Dec 1, 2025". `equidistantPreserveStart`
                  picks the densest even stride that actually fits the rendered axis. */}
              <XAxis
                dataKey="day"
                interval="equidistantPreserveStart"
                minTickGap={14}
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                tick={{ fill: "var(--faint)" }}
              />
              <YAxis
                width={38}
                axisLine={false}
                tickLine={false}
                tickCount={5}
                allowDecimals={false}
                tick={{ fill: "var(--faint)" }}
              />
              <Tooltip
                content={Tip}
                cursor={{ stroke: "var(--tickc)", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              {data.series.map((s, i) => (
                <Area
                  key={s.id}
                  type="monotone"
                  dataKey={slot(i)}
                  name={s.label}
                  stroke={colorAt(i)}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  fill={i === 0 ? colorAt(0) : "none"}
                  fillOpacity={i === 0 ? 0.08 : 0}
                  dot={false}
                  activeDot={{ r: 3.2, strokeWidth: 1.5, stroke: "var(--card)" }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
