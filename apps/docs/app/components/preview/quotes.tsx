"use client";

import { useEffect, useState } from "react";
import { FAINT, MONO } from "./frame";

// --lab-dim / --lab-2 on the site's dark theme
const LAB_DIM = "#8b8b8d";
const LAB_2 = "#a5a5a7";

// mirrors rung() in ThoughtOfTheDay.tsx
const LONG_AT = 90;

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
  dayOfYear?: number;
}) {
  const thought = quotes.length > 0 ? quotes[todayIndex] ?? quotes[0]! : null;
  const shown = quotes[todayIndex] ? todayIndex : 0;
  const today = useUtcToday();

  const body = thought?.quote.trim() ?? "";
  const author = thought?.author.trim() ?? "";
  const long = body.length > LONG_AT;

  return (
    <div>

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
          <blockquote
            className="mt-4 text-[#fafafa]"
            style={{
              maxWidth: long ? "28ch" : "19ch",
              fontSize: long ? 12 : 19,
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
