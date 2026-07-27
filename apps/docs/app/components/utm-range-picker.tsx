"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

/** Compact sizing for the preset row, mirroring `SEL_STYLE` in `tracker/table.tsx` —
 *  `.btn` is a 12.5px/7px control and would tower over the 12px date fields. */
const PRESET_STYLE: React.CSSProperties = { padding: "5px 10px", fontSize: 12 };

const DAY_MS = 86_400_000;
const PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Local-midnight Date from `YYYY-MM-DD`, or null if malformed. Deliberately a copy
 * of `parseRangeParam` in `@/lib/utm` rather than an import: that module pulls in
 * prisma, which cannot cross into a client bundle.
 */
function parseDay(v: string): Date | null {
  const m = PARAM.exec(v);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

/** `YYYY-MM-DD` in LOCAL time — `toISOString()` shifts the day west of Greenwich. */
function toParam(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Inclusive day count; rounds so a 23h/25h DST day still counts as one. */
function spanDays(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

/**
 * Drives `?from=&to=` for the tracker chart. All three props are `YYYY-MM-DD`.
 * `today` comes from the page rather than `new Date()` here: the range, the query
 * window and the chart's columns are all minted on the server's clock, so reading
 * the browser's would give the guard rails and the preset highlight a different
 * "today" whenever the two zones disagree (and it removes the hydration exposure).
 */
export default function UtmRangePicker({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // The inputs are controlled off local state, not the props: a half-typed date makes
  // the native field emit "", and re-imposing the old prop on every keystroke would
  // undo the edit. The URL stays the source of truth — this only mirrors it.
  const [draft, setDraft] = useState({ from, to });

  // Re-sync on back/forward and on the tracker's 40s router.refresh(); the guard keeps
  // an unchanged range from re-rendering (and from stomping on a field being edited).
  useEffect(() => {
    setDraft(d => (d.from === from && d.to === to ? d : { from, to }));
  }, [from, to]);

  const apply = (nextFrom: string, nextTo: string) => {
    // Lexicographic order is chronological for YYYY-MM-DD. A backwards pick is a slip,
    // so swap rather than pushing a range the server would have to repair.
    const [f, t]: [string, string] = nextFrom > nextTo ? [nextTo, nextFrom] : [nextFrom, nextTo];
    setDraft({ from: f, to: t });
    if (f === from && t === to) return;
    // Copied, not rebuilt: the tracker page owns other params and must keep them.
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to", t);
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  const edit = (which: "from" | "to", v: string) => {
    // Cleared or mid-edit: keep the keystroke on screen, leave the URL alone.
    if (!parseDay(v)) { setDraft(d => ({ ...d, [which]: v })); return; }
    // The *other* field may still be cleared. Swapping against "" always compares true,
    // which would push `?from=` and quietly turn the date just picked into the range
    // end — so fall back to the URL's value whenever the sibling is unparseable.
    const sibling = which === "from" ? draft.to : draft.from;
    const other = parseDay(sibling) ? sibling : which === "from" ? to : from;
    apply(which === "from" ? v : other, which === "to" ? v : other);
  };

  const pickPreset = (days: number) => {
    const end = parseDay(today) ?? new Date(); // server's today, not the browser's
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
