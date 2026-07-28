"use client";

import { DIM, FAINT, MONO } from "./frame";

// ─── Quotes Preview ──────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/ThoughtOfTheDay.tsx: one bordered
// card, the label straddling its top edge on a background-coloured strip, the
// quote set italic, and the author on an em-dash beneath.

export function QuotesPreview({ quotes, todayIndex = 0 }: { quotes: { quote: string; author: string }[]; todayIndex?: number }) {
  // The index is computed once by the page using the SAME UTC day-of-year
  // formula the site uses. This component used to invent a third formula
  // (year*10000 + month*100 + day), so the preview, the admin badge and the
  // live site could each show a different quote on the same day.
  const thought = quotes.length > 0 ? quotes[todayIndex] ?? quotes[0]! : null;
  // Which slot that landed on, after the same `?? quotes[0]` fallback — so the
  // caption below never names a position the card isn't actually showing.
  const shown = quotes[todayIndex] ? todayIndex : 0;

  return (
    <div>
      {thought ? (
        <div className="relative rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#171717] px-4 py-5 text-center">
          {/* ThoughtOfTheDay.tsx:20 / :26 — badge and author are `.text-secondary` */}
          <span
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#0a0a0a] px-2 text-[8px] font-medium uppercase tracking-wider"
            style={{ color: DIM }}
          >
            Thought of the Day
          </span>
          <blockquote className="text-[13px] font-medium italic leading-relaxed text-[#fafafa]/90">
            &ldquo;{thought.quote}&rdquo;
          </blockquote>
          <p className="mt-2 text-[10px]" style={{ color: DIM }}>&mdash; {thought.author}</p>
        </div>
      ) : (
        // The real component returns null with no quote, so nothing at all ships
        // — worth saying outright rather than drawing an empty card.
        <p
          className="rounded-xl border border-dashed border-[rgba(255,255,255,0.1)] px-3 py-4 text-center text-[10px] italic"
          style={{ color: FAINT }}
        >
          No quotes yet — the site skips this section entirely.
        </p>
      )}

      {quotes.length > 1 && (
        <p className="mt-2.5 text-center text-[8px]" style={{ fontFamily: MONO, color: FAINT }}>
          quote {shown + 1} of {quotes.length} &middot; rotates daily (UTC)
        </p>
      )}
    </div>
  );
}
