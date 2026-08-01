"use client";

import { useEffect, useState } from "react";
import { FAINT, MONO } from "./frame";

// ─── Quotes Preview ──────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/ThoughtOfTheDay.tsx — "living type".
// The ledger entry is gone: no rule under the quote, no attribution flush right
// on it. The section is now a `.lab` keyline carrying the ledger index, a block
// of very large, very light type, and the author under a rule of their own.
//
// Two rungs, chosen from the quote's own length exactly as `rung()` does on the
// site: past 90 characters the block has stopped being an aphorism, and it steps
// down to the reading size on a wider measure rather than arriving as a slab.
//
// The one thing this pane structurally cannot draw is the section's whole point.
// On the site every word is a span whose `wght` axis swells toward the cursor
// (or, on touch, under a gaussian pulse walking the line); the admin loads only
// Geist, so asking for a variation axis here would silently synthesise. The
// quote is drawn at one static weight instead — the same resting weight the site
// itself settles on for a visitor who asked for reduced motion.
//
// The quote shown is the one today's rotation lands on — the same one the site
// renders, which ships exactly one quote and offers no way to page past it.

/** `--lab-dim` / `--lab-2` on the site's dark theme. */
const LAB_DIM = "#8b8b8d";
const LAB_2 = "#a5a5a7";

/** `rung()` in ThoughtOfTheDay.tsx — the one number that tunes the copyfit. */
const LONG_AT = 90;

/**
 * The date the keyline stamps ("aug 1"), and how many days the year holds — the
 * denominator of the ledger index. Both come off the same UTC midnight
 * `thoughtOfDay` uses in apps/web/app/page.tsx. Null until mounted: the site
 * computes them on the server, and computing them during this pane's render
 * would let the server HTML and the first client pass disagree across UTC
 * midnight.
 */
function useUtcToday(): { date: string; days: number } | null {
  const [today, setToday] = useState<{ date: string; days: number } | null>(null);
  useEffect(() => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const midnight = Date.UTC(year, now.getUTCMonth(), now.getUTCDate());
    setToday({
      date: new Date(midnight)
        .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
        .toLowerCase(),
      days: year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365,
    });
  }, []);
  return today;
}

export function QuotesPreview({ quotes, todayIndex = 0, dayOfYear }: {
  quotes: { quote: string; author: string }[];
  todayIndex?: number;
  /** The raw UTC day-of-year the page computed — the numerator of "day N / 365",
      and the same number the site prints. Never recomputed here: the page, the
      table badge and the site already agree on one formula. */
  dayOfYear?: number;
}) {
  // The index is computed once by the page using the SAME UTC day-of-year
  // formula the site uses. This component used to invent a third formula
  // (year*10000 + month*100 + day), so the preview, the admin badge and the
  // live site could each show a different quote on the same day.
  const thought = quotes.length > 0 ? quotes[todayIndex] ?? quotes[0]! : null;
  // Which slot that landed on, after the same `?? quotes[0]` fallback — so the
  // caption below never names a position the pane isn't actually showing.
  const shown = quotes[todayIndex] ? todayIndex : 0;
  const today = useUtcToday();

  // A CMS row can exist with a blank body, and the site returns null on one —
  // an empty row is a skipped section, not an empty pull quote.
  const body = thought?.quote.trim() ?? "";
  const author = thought?.author.trim() ?? "";
  const long = body.length > LONG_AT;

  return (
    <div>
      {/* `.lab` with the day index and the date hung off it as hints:
          lowercase, lighter, untracked. */}
      <div
        className="flex flex-wrap items-center gap-2 uppercase"
        style={{ fontFamily: MONO, fontSize: 7, fontWeight: 500, letterSpacing: "0.18em", color: LAB_DIM }}
      >
        <span className="flex-none" style={{ marginRight: "-0.18em" }}>thought of the day</span>
        <i className="h-px min-w-3 flex-1" style={{ background: "rgba(255,255,255,0.1)" }} aria-hidden="true" />
        {today && dayOfYear !== undefined && (
          <span className="normal-case" style={{ letterSpacing: 0, fontWeight: 400, color: LAB_2 }}>
            day {dayOfYear} / {today.days}
          </span>
        )}
        {today && (
          <span className="normal-case" style={{ letterSpacing: 0, fontWeight: 400, color: LAB_2 }}>
            {today.date}
          </span>
        )}
      </div>

      {body ? (
        <>
          {/* The measure is in `ch`, so it moves with the rung: 19ch of display
              type and 28ch of reading type are close to the same line length,
              which is what keeps the step down from re-ragging the block. */}
          <blockquote
            className="mt-4 text-[#fafafa]"
            style={{
              maxWidth: long ? "28ch" : "19ch",
              fontSize: long ? 12 : 19,
              // 400, not the site's resting 250: the axis is unavailable here
              // (see the header), and a synthesised light face is worse than an
              // honest regular one.
              fontWeight: 400,
              letterSpacing: long ? "-0.018em" : "-0.028em",
              lineHeight: long ? 1.35 : 1.14,
              textWrap: "balance",
              overflowWrap: "break-word",
            }}
          >
            {body}
          </blockquote>

          <p className="mt-1.5 opacity-75" style={{ fontFamily: MONO, fontSize: 6.5, letterSpacing: "0.05em", color: LAB_DIM }}>
            ⌖ move your cursor through the words
          </p>

          {author && (
            <div className="mt-3 flex max-w-[300px] flex-wrap items-center gap-2">
              <i className="h-px min-w-3 flex-1" style={{ background: "rgba(255,255,255,0.1)" }} aria-hidden="true" />
              <span className="min-w-0 text-[8.5px]" style={{ color: LAB_2 }}>&mdash; {author}</span>
            </div>
          )}
        </>
      ) : (
        // The real component returns null with no quote — and with a blank one —
        // so nothing at all ships. Worth saying outright rather than drawing an
        // empty pull quote.
        <p
          className="mt-3.5 rounded-xl border border-dashed border-[rgba(255,255,255,0.1)] px-3 py-4 text-center text-[10px] italic"
          style={{ color: FAINT }}
        >
          {quotes.length === 0
            ? "No quotes yet — the site skips this section entirely."
            : "Today's quote has no text — the site skips this section entirely."}
        </p>
      )}

      {quotes.length > 1 && (
        <p className="mt-3 text-[8px]" style={{ fontFamily: MONO, color: FAINT }}>
          quote {shown + 1} of {quotes.length} &middot; rotates daily (UTC)
        </p>
      )}
    </div>
  );
}
