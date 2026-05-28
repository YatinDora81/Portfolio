import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { TrackerTable } from "./table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TrackerPage() {
  const rows = await prisma.utmTracker.findMany({
    orderBy: { visitedAt: "desc" },
    take: 2000,
  });

  return (
    <div>
      <PageHeader
        title="Tracker"
        description={`${rows.length} latest UTM hits captured from website URLs`}
      />
      <TrackerTable
        rows={rows.map((r) => ({
          id: r.id,
          source: r.source,
          medium: r.medium,
          campaign: r.campaign,
          content: r.content,
          term: r.term,
          messageId: r.messageId,
          path: r.path,
          referrer: r.referrer,
          userAgent: r.userAgent,
          visitedAt: r.visitedAt.toISOString(),
        }))}
      />
    </div>
  );
}
