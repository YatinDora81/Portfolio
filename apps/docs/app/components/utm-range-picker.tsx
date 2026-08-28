"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

const PRESET_STYLE: React.CSSProperties = { padding: "5px 10px", fontSize: 12 };

const DAY_MS = 86_400_000;
const PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

// copy of parseRangeParam; @/lib/utm pulls in prisma
function parseDay(v: string): Date | null {
  const m = PARAM.exec(v);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

// local time; toISOString() shifts the day west
function toParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// rounds so a DST day still counts as one
function spanDays(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

export default function UtmRangePicker({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ from, to });

  useEffect(() => {
    setDraft(d => (d.from === from && d.to === to ? d : { from, to }));
  }, [from, to]);

  const apply = (nextFrom: string, nextTo: string) => {
    const [f, t]: [string, string] = nextFrom > nextTo ? [nextTo, nextFrom] : [nextFrom, nextTo];
    setDraft({ from: f, to: t });
    if (f === from && t === to) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to", t);
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  const edit = (which: "from" | "to", v: string) => {
    if (!parseDay(v)) { setDraft(d => ({ ...d, [which]: v })); return; }
    const sibling = which === "from" ? draft.to : draft.from;
    const other = parseDay(sibling) ? sibling : which === "from" ? to : from;
    apply(which === "from" ? v : other, which === "to" ? v : other);
  };

  const pickPreset = (days: number) => {
    const end = parseDay(today) ?? new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
    apply(toParam(start), toParam(end));
  };

  const fromDay = parseDay(draft.from), toDay = parseDay(draft.to);
  const span = fromDay && toDay ? spanDays(fromDay, toDay) : 0;
  const endsToday = draft.to === today;

  return (
    <div className="utm-range" aria-busy={isPending} style={isPending ? { opacity: .55 } : undefined}>
      <input
        type="date"
        className="in"
        aria-label="Range start"
        value={draft.from}
        max={draft.to}
        onChange={e => edit("from", e.target.value)}
      />
      <span aria-hidden style={{ color: "var(--faint)", fontSize: 11 }}>→</span>
      <input
        type="date"
        className="in"
        aria-label="Range end"
        value={draft.to}
        min={draft.from}
        max={today}
        onChange={e => edit("to", e.target.value)}
      />
      {PRESETS.map(p => {
        const on = endsToday && span === p.days;
        return (
          <button
            key={p.days}
            type="button"
            className={`btn ${on ? "pri" : "ghost"}`}
            style={PRESET_STYLE}
            aria-pressed={on}
            onClick={() => pickPreset(p.days)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
