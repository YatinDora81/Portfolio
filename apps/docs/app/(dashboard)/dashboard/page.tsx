import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import UtmTracerChart from "@/components/utm-tracer-chart";
import { getUtmSeries } from "@/lib/utm";
import {
  IconInbox, IconPencil, IconFolderCode, IconCpu, IconPlus, IconSparkles,
  IconSettings2, IconArrowUpRight, IconUser, IconQuote, IconTag, IconLink,
} from "@tabler/icons-react";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");
const SITE_HOST = SITE.replace(/^https?:\/\//, "");

async function getDashboardData() {
  const [
    unreadMessages, totalMessages, recentMessages,
    liveBlogs, totalBlogs,
    totalProjects, projectsWithLive,
    visibleSkills, totalSkills,
    heroTitles, aboutParagraphs, quotes, contactPurposes, socialLinks,
    utm,
  ] = await Promise.all([
    prisma.contactMessage.count({ where: { read: false } }),
    prisma.contactMessage.count(),
    prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.blog.count({ where: { show: true } }),
    prisma.blog.count(),
    prisma.project.count(),
    prisma.project.count({ where: { live: { not: null } } }),
    prisma.skill.count({ where: { show: true } }),
    prisma.skill.count(),
    prisma.heroTitle.count(),
    prisma.aboutParagraph.count(),
    prisma.quote.count(),
    prisma.contactPurpose.count(),
    prisma.socialLink.count(),
    getUtmSeries(14),
  ]);

  return {
    unreadMessages, totalMessages, recentMessages,
    liveBlogs, totalBlogs,
    totalProjects, projectsWithLive,
    visibleSkills, totalSkills,
    heroTitles, aboutParagraphs, quotes, contactPurposes, socialLinks,
    utm,
  };
}

/** Compact "3h" / "5d" stamp for the recent-message rows. */
function ago(date: Date) {
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

const HEALTH: { label: string; href: string; icon: typeof IconSparkles }[] = [
  { label: "Hero titles", href: "/hero/titles", icon: IconSparkles },
  { label: "About paragraphs", href: "/about/paragraphs", icon: IconUser },
  { label: "Quotes in rotation", href: "/quotes", icon: IconQuote },
  { label: "Contact purposes", href: "/contact-purposes", icon: IconTag },
  { label: "Social links", href: "/links", icon: IconLink },
];

export default async function DashboardPage() {
  const d = await getDashboardData();

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const hiddenBlogs = d.totalBlogs - d.liveBlogs;
  const hiddenSkills = d.totalSkills - d.visibleSkills;

  const healthCounts = [d.heroTitles, d.aboutParagraphs, d.quotes, d.contactPurposes, d.socialLinks];

  return (
    <div className="view">
      <PageHeader
        eyebrow={today}
        title={greeting}
        description={`Everything behind ${SITE_HOST} — content, inbox and publish state in one place.`}
      />

      <div className="stat-grid">
        <Link href="/messages" className="stat">
          <div className="stat-k"><IconInbox size={11} /> unread messages</div>
          <div className="stat-v">{d.unreadMessages}</div>
          <div className="stat-m">
            {d.unreadMessages > 0
              ? <><i>waiting on a reply</i> · {d.totalMessages} all time</>
              : <><em>inbox zero</em> · {d.totalMessages} all time</>}
          </div>
        </Link>

        <Link href="/blogs" className="stat">
          <div className="stat-k"><IconPencil size={11} /> live posts</div>
          <div className="stat-v">{d.liveBlogs}</div>
          <div className="stat-m">
            {hiddenBlogs > 0 ? <>{hiddenBlogs} hidden</> : <em>all published</em>}
          </div>
        </Link>

        <Link href="/projects" className="stat">
          <div className="stat-k"><IconFolderCode size={11} /> projects</div>
          <div className="stat-v">{d.totalProjects}</div>
          <div className="stat-m">{d.projectsWithLive} with a live link</div>
        </Link>

        <Link href="/skills" className="stat">
          <div className="stat-k"><IconCpu size={11} /> skills visible</div>
          <div className="stat-v">{d.visibleSkills}</div>
          <div className="stat-m">
            {hiddenSkills > 0 ? <>{hiddenSkills} hidden</> : <em>all visible</em>}
          </div>
        </Link>
      </div>

      <UtmTracerChart data={d.utm} />

      <div className="dash-grid">
        <div className="flex flex-col gap-3.5">
          <Card className="pubcard">
            <div className="flex items-center gap-2.5">
              <span className="live-dot" />
              <div className="card-t">Live at {SITE_HOST}</div>
              <div className="sp" />
              <a className="btn" href={SITE} target="_blank" rel="noreferrer">
                Open site <IconArrowUpRight size={14} className="nudge" />
              </a>
            </div>
            <p style={{ color: "var(--dim)", fontSize: 12.5, lineHeight: 1.65, marginTop: 10 }}>
              The portfolio serves cached pages, so edits made here go out on the next rebuild.
              Hit <b style={{ color: "var(--ink)", fontWeight: 600 }}>Publish</b> in the top bar to
              flush the cache and push everything live immediately.
            </p>
          </Card>

          <Card flush>
            <CardHead
              title="Recent messages"
              count={d.totalMessages}
              right={
                <Link href="/messages" className="btn ghost">
                  Open inbox <IconArrowUpRight size={13} className="nudge" />
                </Link>
              }
            />
            {d.recentMessages.length === 0 ? (
              <div className="empty">
                <div className="empty-ic"><IconInbox size={19} /></div>
                <b>No messages yet</b>
                <span>Anything sent through the contact form on the site lands here.</span>
              </div>
            ) : (
              <div className="rows">
                {d.recentMessages.map((m, i) => (
                  <Link key={m.id} href="/messages" className="row">
                    <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
                    <div className="row-main">
                      <div className="row-t">{m.name}</div>
                      <div className="row-m">
                        {m.purpose ? `${m.purpose} · ` : ""}{m.message}
                      </div>
                    </div>
                    <div className="row-acts" style={{ gap: 8 }}>
                      {!m.read ? <Badge variant="warning" dot>new</Badge> : null}
                      <span className="msg-when">{ago(m.createdAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card flush>
            <CardHead title="Quick actions" />
            <div className="card-b">
              <div className="qa">
                <Link href="/blogs/new" className="qa-btn"><IconPlus size={15} /> New blog post</Link>
                <Link href="/projects/new" className="qa-btn"><IconFolderCode size={15} /> Add project</Link>
                <Link href="/hero/titles" className="qa-btn"><IconSparkles size={15} /> Edit hero</Link>
                <Link href="/site-config" className="qa-btn"><IconSettings2 size={15} /> Site config</Link>
              </div>
            </div>
          </Card>

          <Card flush className="health">
            <CardHead title="Content health" count={HEALTH.length} />
            <div className="rows">
              {HEALTH.map((h, i) => {
                const Icon = h.icon;
                const n = healthCounts[i] ?? 0;
                return (
                  <Link key={h.href} href={h.href} className="row">
                    <span className="row-i" style={{ display: "inline-flex" }}><Icon size={13} /></span>
                    <div className="row-main">
                      <div className="row-t">{h.label}</div>
                    </div>
                    <span className="card-n">{String(n).padStart(2, "0")}</span>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
