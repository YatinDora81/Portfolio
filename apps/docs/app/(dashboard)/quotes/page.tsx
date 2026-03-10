import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { QuotesTable } from "./table";
import { PreviewFrame, QuotesPreview } from "@/components/preview";

export default async function QuotesPage() {
  const quotes = await prisma.quote.findMany();
  return (
    <div>
      <PageHeader title="Quotes" description="Daily rotating quotes on the portfolio" />
      <QuotesTable quotes={quotes.map(q => ({ id: q.id, quote: q.quote, author: q.author }))} />
      <PreviewFrame label="Quotes Preview">
        <QuotesPreview
          quotes={quotes.map(q => ({ quote: q.quote, author: q.author }))}
        />
      </PreviewFrame>
    </div>
  );
}
