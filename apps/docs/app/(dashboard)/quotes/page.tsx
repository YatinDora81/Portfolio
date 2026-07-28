import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { QuotesTable } from "./table";
import { StagedQuotesPreview } from "@/components/preview/staged";

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
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfYear = Math.floor((today - start) / 86_400_000);
  return (
    <div className="view">
      <PageHeader
        eyebrow="section 07"
        title="Quotes"
        description="The thought-of-the-day line on the portfolio — the highlighted entry is the one visitors see today. It rotates by date, not by position."
      />
      <QuotesTable quotes={quotes.map(q => ({ id: q.id, quote: q.quote, author: q.author }))} dayOfYear={dayOfYear} />
      <StagedQuotesPreview
        quotes={quotes.map(q => ({ id: q.id, quote: q.quote, author: q.author }))}
        dayOfYear={dayOfYear}
      />
    </div>
  );
}
