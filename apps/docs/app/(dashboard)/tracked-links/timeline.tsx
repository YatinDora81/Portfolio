"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";

export type ClickDay = { day: string; clicks: number };

function Tip({ active, label, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const clicks = Number(payload[0]?.value ?? 0);
  return (
    <div className="utm-tip">
      <div className="d">{label}</div>
      <div className="r">
        <span>clicks</span>
        <b>{clicks}</b>
      </div>
    </div>
  );
}

export function ClickTimeline({ days }: { days: ClickDay[] }) {
  return (
    <div className="utm-wrap">
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={days} margin={{ top: 14, right: 14, bottom: 6, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--gridc)" />
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
            tickCount={4}
            allowDecimals={false}
            tick={{ fill: "var(--faint)" }}
          />
          <Tooltip content={Tip} cursor={{ fill: "var(--bg2)" }} />
          <Bar dataKey="clicks" fill="var(--ch1)" radius={[3, 3, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
