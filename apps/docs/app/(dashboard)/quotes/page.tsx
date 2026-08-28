import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { QuotesTable } from "./table";
import { StagedQuotesPreview } from "@/components/preview/staged";
import { IconArrowUpRight } from "@tabler/icons-react";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

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
  // Quote has no sortOrder, so id asc is the only stable order
  const quotes = await prisma.quote.findMany({ orderBy: { id: "asc" } });

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
          <a href={SITE} target="_blank" rel="noreferrer">
            no anchor · between #blogs and #contact <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        <div className="sec-reach" />
      </div>

      <QuotesTable
        quotes={rows}
        dayOfYear={dayOfYearUTC(today)}
        // off tomorrow's own midnight, so 31 december rolls to day 1
        nextDayOfYear={dayOfYearUTC(tomorrow)}
        daysInYear={year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365}
        todayLabel={fmtUTC(today)}
        nextLabel={fmtUTC(tomorrow)}
      />

      <StagedQuotesPreview quotes={rows} dayOfYear={dayOfYearUTC(today)} />
    </div>
  );
}
