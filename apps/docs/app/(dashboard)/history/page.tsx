import { prisma } from "db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { getSession } from "@/lib/session";
import { HistoryTable } from "./table";

// The log moves on every save; a cached page would show a history that is
// already out of date the moment it matters.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Newest N events. Children are NOT loaded — one reorder can carry hundreds. */
const EVENT_CAP = 200;

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [events, lastPublish] = await Promise.all([
    prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: EVENT_CAP }),
    // Its own query rather than a scan of the page above: the most recent
    // successful publish can easily be older than the newest 200 events.
    prisma.auditEvent.findFirst({
      where: { publishState: "OK" },
      orderBy: { publishedAt: "desc" },
      select: { actorName: true, actorRole: true, publishedAt: true },
    }),
  ]);

  return (
    <div className="view">
      <PageHeader
        eyebrow="access control · audit"
        title="Change history"
        description="Every save and every publish, with the exact text before and after. Visible to every signed-in admin; nothing here can be edited."
      />
      <HistoryTable
        events={events.map((e) => ({
          id: e.id,
          action: e.action,
          surface: e.surface,
          createdAt: e.createdAt.toISOString(),
          actorName: e.actorName,
          actorEmail: e.actorEmail,
          actorRole: e.actorRole,
          publishState: e.publishState,
          publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
          publishError: e.publishError,
          changeCount: e.changeCount,
          summary: e.summary,
        }))}
        lastPublish={
          lastPublish?.publishedAt
            ? {
                actorName: lastPublish.actorName,
                actorRole: lastPublish.actorRole,
                publishedAt: lastPublish.publishedAt.toISOString(),
              }
            : null
        }
        capped={events.length === EVENT_CAP}
      />
    </div>
  );
}
