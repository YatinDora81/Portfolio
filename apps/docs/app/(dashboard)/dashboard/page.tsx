import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import {
  PreviewFrame, HeroPreview, AboutPreview, SkillsPreview,
  ExperiencePreview, ProjectsPreview, BlogsPreview, QuotesPreview, ContactPreview,
} from "@/components/preview";
import {
  IconSparkles, IconInfoCircle, IconCode, IconBriefcase,
  IconFolder, IconArticle, IconQuote, IconMail, IconSettings, IconUsers,
  IconArrowRight, IconMessage,
} from "@tabler/icons-react";

async function getDashboardData() {
  const [
    titles, skillBadges, socialLinks, paragraphs, education,
    skills, experiences, projects, blogs, quotes, purposes, siteConfigRows, adminUsers,
    unreadMessages, totalMessages,
  ] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.heroSkillBadge.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.aboutParagraph.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.education.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.skill.findMany({ where: { show: true }, orderBy: { sortOrder: "asc" } }),
    prisma.experience.findMany({
      orderBy: { sortOrder: "asc" },
      include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { name: true } } },
    }),
    prisma.project.findMany({
      orderBy: { sortOrder: "asc" },
      include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { name: true } } },
    }),
    prisma.blog.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.quote.findMany(),
    prisma.contactPurpose.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.siteConfig.findMany(),
    prisma.adminUser.count(),
    prisma.contactMessage.count({ where: { read: false } }),
    prisma.contactMessage.count(),
  ]);

  const cfg = new Map(siteConfigRows.map(c => [c.key, c.value]));

  return {
    hero: {
      titles: titles.map(t => t.title),
      skillBadges: skillBadges.map(s => ({ name: s.name })),
      socialLinks: socialLinks.map(l => ({ name: l.name })),
      name: cfg.get("name") || "Yatin",
      tagline: cfg.get("tagline") || "",
      intro: cfg.get("intro") || "",
      avatarUrl: cfg.get("avatarUrl") || "",
      stats: `${titles.length} titles · ${skillBadges.length} badges · ${socialLinks.length} social links`,
    },
    about: {
      paragraphs: paragraphs.map(p => p.content),
      education: education.map(e => ({
        institution: e.institution, degree: e.degree, location: e.location,
        scoreType: e.scoreType, score: e.score, scoreTotal: e.scoreTotal,
        startYear: e.startYear, endYear: e.endYear,
      })),
      stats: `${paragraphs.length} paragraphs · ${education.length} education`,
    },
    skills: {
      items: skills.map(s => ({ name: s.name })),
      stats: `${skills.length} visible skills`,
    },
    experiences: {
      items: experiences.map(exp => ({
        company: exp.company, position: exp.position, location: exp.location,
        startDate: exp.startDate, endDate: exp.endDate, isCurrent: exp.isCurrent,
        bullets: exp.bullets.map(b => b.content), technologies: exp.skills.map(s => s.name),
      })),
      stats: `${experiences.length} entries`,
    },
    projects: {
      items: projects.map(p => ({
        title: p.title, summary: p.summary, github: p.github, live: p.live,
        bullets: p.bullets.map(b => b.content), technologies: p.skills.map(s => s.name),
      })),
      stats: `${projects.length} projects`,
    },
    blogs: {
      items: blogs.map(b => ({ title: b.title, description: b.description, image: b.image, imageOrientation: b.imageOrientation })),
      stats: `${blogs.length} posts`,
    },
    quotes: {
      items: quotes.map(q => ({ quote: q.quote, author: q.author })),
      stats: `${quotes.length} quotes`,
    },
    contact: {
      purposes: purposes.map(p => ({ label: p.label, emoji: p.emoji })),
      socialLinks: socialLinks.map(l => ({ name: l.name })),
      availabilityStatus: cfg.get("availabilityStatus") || "",
      availabilityDetail: cfg.get("availabilityDetail") || "",
      stats: `${purposes.length} purposes`,
    },
    siteConfigCount: siteConfigRows.length,
    adminUsers,
    unreadMessages,
    totalMessages,
  };
}

const iconBgColors: Record<string, string> = {
  purple: "from-purple-500/15 to-purple-600/5 text-purple-500 dark:from-purple-500/20 dark:to-purple-600/10",
  teal: "from-teal-500/15 to-teal-600/5 text-teal-500 dark:from-teal-500/20 dark:to-teal-600/10",
  green: "from-emerald-500/15 to-emerald-600/5 text-emerald-500 dark:from-emerald-500/20 dark:to-emerald-600/10",
  indigo: "from-indigo-500/15 to-indigo-600/5 text-indigo-500 dark:from-indigo-500/20 dark:to-indigo-600/10",
  orange: "from-orange-500/15 to-orange-600/5 text-orange-500 dark:from-orange-500/20 dark:to-orange-600/10",
  pink: "from-pink-500/15 to-pink-600/5 text-pink-500 dark:from-pink-500/20 dark:to-pink-600/10",
  cyan: "from-cyan-500/15 to-cyan-600/5 text-cyan-500 dark:from-cyan-500/20 dark:to-cyan-600/10",
  rose: "from-rose-500/15 to-rose-600/5 text-rose-500 dark:from-rose-500/20 dark:to-rose-600/10",
  blue: "from-blue-500/15 to-blue-600/5 text-blue-500 dark:from-blue-500/20 dark:to-blue-600/10",
  slate: "from-slate-500/15 to-slate-600/5 text-slate-500 dark:from-slate-400/20 dark:to-slate-500/10",
  violet: "from-violet-500/15 to-violet-600/5 text-violet-500 dark:from-violet-500/20 dark:to-violet-600/10",
};

interface SectionCardProps {
  icon: React.ElementType;
  color: string;
  title: string;
  stats: string;
  links: { label: string; href: string }[];
  children: React.ReactNode;
}

function SectionCard({ icon: Icon, color, title, stats, links, children }: SectionCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`bg-gradient-to-br ${iconBgColors[color] || iconBgColors.blue} rounded-xl p-2.5`}>
            <Icon size={18} stroke={1.5} />
          </div>
          <div>
            <h2 className="font-semibold tracking-tight">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{stats}</p>
          </div>
        </div>
      </div>

      <PreviewFrame className="mt-4" label={`${title} Preview`}>
        {children}
      </PreviewFrame>

      <div className="mt-4 flex flex-wrap gap-2">
        {links.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:text-foreground hover:border-border hover:bg-muted/60 hover:shadow-sm"
          >
            {l.label}
            <IconArrowRight size={12} />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function QuickLinkCard({
  icon: Icon,
  color,
  title,
  subtitle,
  href,
  action,
  badge,
}: {
  icon: React.ElementType;
  color: string;
  title: string;
  subtitle: string;
  href: string;
  action: string;
  badge?: number;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className={`relative bg-gradient-to-br ${iconBgColors[color] || iconBgColors.blue} rounded-xl p-2.5`}>
          <Icon size={18} stroke={1.5} />
          {badge != null && badge > 0 && (
            <span className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-card">
              {badge}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:text-foreground hover:border-border hover:bg-muted/60 hover:shadow-sm shrink-0"
        >
          {action} <IconArrowRight size={12} />
        </Link>
      </div>
    </Card>
  );
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="max-w-5xl">
      <PageHeader title="Dashboard" description="Manage your portfolio sections — preview how each looks on your site" />

      <div className="space-y-5">
        <SectionCard
          icon={IconSparkles}
          color="purple"
          title="Hero Section"
          stats={data.hero.stats}
          links={[
            { label: "Edit Titles", href: "/hero/titles" },
            { label: "Edit Badges", href: "/hero/skill-badges" },
            { label: "Edit Links", href: "/links" },
            { label: "Site Config", href: "/site-config" },
          ]}
        >
          <HeroPreview
            titles={data.hero.titles}
            name={data.hero.name}
            tagline={data.hero.tagline}
            intro={data.hero.intro}
            skills={data.hero.skillBadges}
            socialLinks={data.hero.socialLinks}
            avatarUrl={data.hero.avatarUrl}
          />
        </SectionCard>

        <SectionCard
          icon={IconInfoCircle}
          color="teal"
          title="About Section"
          stats={data.about.stats}
          links={[
            { label: "Edit Paragraphs", href: "/about/paragraphs" },
            { label: "Edit Education", href: "/about/education" },
          ]}
        >
          <AboutPreview paragraphs={data.about.paragraphs} education={data.about.education} />
        </SectionCard>

        <SectionCard
          icon={IconCode}
          color="green"
          title="Skills Section"
          stats={data.skills.stats}
          links={[{ label: "Edit Skills", href: "/skills" }]}
        >
          <SkillsPreview skills={data.skills.items} />
        </SectionCard>

        <SectionCard
          icon={IconBriefcase}
          color="indigo"
          title="Experience Section"
          stats={data.experiences.stats}
          links={[{ label: "Edit Experiences", href: "/experiences" }]}
        >
          <ExperiencePreview experiences={data.experiences.items} />
        </SectionCard>

        <SectionCard
          icon={IconFolder}
          color="orange"
          title="Projects Section"
          stats={data.projects.stats}
          links={[{ label: "Edit Projects", href: "/projects" }]}
        >
          <ProjectsPreview projects={data.projects.items} />
        </SectionCard>

        <SectionCard
          icon={IconArticle}
          color="pink"
          title="Blogs Section"
          stats={data.blogs.stats}
          links={[{ label: "Edit Blogs", href: "/blogs" }]}
        >
          <BlogsPreview blogs={data.blogs.items} />
        </SectionCard>

        <SectionCard
          icon={IconQuote}
          color="cyan"
          title="Thought of the Day"
          stats={data.quotes.stats}
          links={[{ label: "Edit Quotes", href: "/quotes" }]}
        >
          <QuotesPreview quotes={data.quotes.items} />
        </SectionCard>

        <SectionCard
          icon={IconMail}
          color="rose"
          title="Contact Section"
          stats={data.contact.stats}
          links={[
            { label: "Edit Purposes", href: "/contact-purposes" },
            { label: "Site Config", href: "/site-config" },
          ]}
        >
          <ContactPreview
            purposes={data.contact.purposes}
            availabilityStatus={data.contact.availabilityStatus}
            availabilityDetail={data.contact.availabilityDetail}
            socialLinks={data.contact.socialLinks}
          />
        </SectionCard>

        {/* Quick Links */}
        <QuickLinkCard
          icon={IconMessage}
          color="blue"
          title="Messages"
          subtitle={`${data.totalMessages} total${data.unreadMessages > 0 ? ` · ${data.unreadMessages} unread` : ""}`}
          href="/messages"
          action="View"
          badge={data.unreadMessages}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickLinkCard
            icon={IconSettings}
            color="slate"
            title="Site Config"
            subtitle={`${data.siteConfigCount} settings`}
            href="/site-config"
            action="Edit"
          />
          <QuickLinkCard
            icon={IconUsers}
            color="violet"
            title="Admin Users"
            subtitle={`${data.adminUsers} users`}
            href="/admin-users"
            action="Manage"
          />
        </div>
      </div>
    </div>
  );
}
