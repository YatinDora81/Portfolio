import { prisma } from "db";
import { redirect } from "next/navigation";
import { IconClock, IconLink, IconPointer, IconUsers } from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { istLabel } from "@/lib/lifecycle";
import { getSession } from "@/lib/session";
import { destinationOptions, shortUrl } from "@/lib/tracked-links";
import { CreateLinkForm, LinkTable, type LinkRow } from "./parts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** IST is UTC+05:30 all year, so today's boundary is arithmetic rather than a lookup. */
function istMidnight(now = new Date()): Date {
  return new Date(Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

export default async function TrackedLinksPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const dayStart = istMidnight();

  const [links, destinations, totalClicks, todayClicks, todayVisitors] = await Promise.all([
    prisma.trackedLink.findMany({ orderBy: [{ clickCount: "desc" }, { createdAt: "desc" }] }),
    destinationOptions(),
    prisma.linkClick.count(),
    prisma.linkClick.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.linkClick.groupBy({
      by: ["visitorHash"],
      where: { createdAt: { gte: dayStart } },
    }),
  ]);

  const rows: LinkRow[] = links.map((l) => ({
    id: l.id,
    slug: l.slug,
    label: l.label,
    channel: l.channel,
    campaign: l.campaign,
    destination: l.destination,
    notes: l.notes,
    active: l.active,
    clickCount: l.clickCount,
    shortUrl: shortUrl(l.slug),
    createdAt: l.createdAt.toISOString(),
    createdLabel: istLabel(l.createdAt),
    lastClickAt: l.lastClickAt?.toISOString() ?? null,
    lastClickLabel: l.lastClickAt ? istLabel(l.lastClickAt) : null,
  }));

  const live = rows.filter((r) => r.active).length;

  return (
    <div className="view wide">
      <PageHeader
        eyebrow="outreach · short links"
        title="Tracked links"
        description="One short link per place you put your name. Every open is counted here, so a resume that went out three weeks ago can tell you whether anybody read it."
      />

      <div className="stat-grid even">
        <div className="stat">
          <div className="stat-k">
            <IconLink size={11} /> links
          </div>
          <div className="stat-v">{rows.length}</div>
          <div className="stat-m">
            {rows.length === 0 ? (
              <em>none yet</em>
            ) : (
              <>
                {live} live · {rows.length - live} retired
              </>
            )}
          </div>
        </div>

        <div className="stat">
          <div className="stat-k">
            <IconPointer size={11} /> clicks
          </div>
          <div className="stat-v">{totalClicks}</div>
          <div className="stat-m">every open since the first link was made</div>
        </div>

        <div className="stat">
          <div className="stat-k">
            <IconClock size={11} /> clicks today
          </div>
          <div className="stat-v">{todayClicks}</div>
          <div className="stat-m">since midnight IST</div>
        </div>

        <div className="stat">
          <div className="stat-k">
            <IconUsers size={11} /> unique today
          </div>
          <div className="stat-v">{todayVisitors.length}</div>
          {/* 🚨 Never call this "unique visitors": the hashing salt is dropped and
              redrawn every night, so the same person tomorrow is a different hash
              by construction and no figure here can span two days. */}
          <div className="stat-m">
            <i>today only</i> — the salt rotates at midnight, so this cannot be added up across days
          </div>
        </div>
      </div>

      <CreateLinkForm destinations={destinations} />
      <LinkTable rows={rows} />
    </div>
  );
}
