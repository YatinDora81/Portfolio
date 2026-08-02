import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { QuotesTable } from "./table";
import { StagedQuotesPreview } from "@/components/preview/staged";
import { IconArrowUpRight } from "@tabler/icons-react";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

/** Day of the year, 1-based, off UTC midnight — the same arithmetic
 *  `thoughtOfDay` runs in apps/web/app/page.tsx. */
function dayOfYearUTC(ms: number) {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((ms - start) / 86_400_000);
}

const fmtUTC = (ms: number) =>
  new Date(ms)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toLowerCase();

export default async function QuotesPage() {
  // Same ordering as the site (apps/web/app/lib/data.ts getQuotes) — Quote has
  // no sortOrder, so `id asc` is the only stable order. Without it Postgres row
  // order is arbitrary and the admin's numbering matches nothing.
  const quotes = await prisma.quote.findMany({ orderBy: { id: "asc" } });

  // Same deterministic UTC day-of-year as apps/web/app/page.tsx. The site does
  // NOT show index 0, so badging the first row was simply wrong. The day goes
  // out raw, undivided: the table and the preview each run the modulo over the
  // list they are showing, which is the only way a staged delete leaves them
  // agreeing with each other and with the quote the site will publish.
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const tomorrow = today + 86_400_000;
  const year = now.getUTCFullYear();

  const rows = quotes.map(q => ({ id: q.id, quote: q.quote, author: q.author }));

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 07"
        title="Thought of the day"
        description="One line, chosen by the date rather than by position — the same quote for every visitor, all day, then a different one at UTC midnight."
      />

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">07</span>
        <div className="sec-anchor">
          {/* The section is the only one on the page with no id of its own, so
              there is nothing to deep-link to — say so rather than invent one. */}
          <a href={SITE} target="_blank" rel="noreferrer">
            no anchor · between #blogs and #contact <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        <div className="sec-reach" />
      </div>

      <QuotesTable
        quotes={rows}
        dayOfYear={dayOfYearUTC(today)}
        // Recomputed off tomorrow's own midnight rather than day+1, so 31
        // December rolls to day 1 instead of overshooting the year.
        nextDayOfYear={dayOfYearUTC(tomorrow)}
        daysInYear={year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365}
        todayLabel={fmtUTC(today)}
        nextLabel={fmtUTC(tomorrow)}
      />

      <StagedQuotesPreview quotes={rows} dayOfYear={dayOfYearUTC(today)} />
    </div>
  );
}
