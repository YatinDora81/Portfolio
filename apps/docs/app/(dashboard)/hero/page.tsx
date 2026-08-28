import { prisma } from "db";
import { IconArrowUpRight } from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { keysFor, DEFAULTS } from "@/lib/site-config-keys";
import { HeroSections } from "./sections";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/+$/, "");

export default async function HeroPage() {
  const [titles, badges, socialLinks, content, siteConfigRows, totalSkills] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroContent.findMany({ orderBy: { version: "asc" } }),
    prisma.siteConfig.findMany(),
    prisma.skill.count({ where: { show: true } }),
  ]);

  const cfg = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const config = Object.fromEntries(
    keysFor("hero").map((k) => [k, cfg.get(k) ?? DEFAULTS[k] ?? ""])
  );

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 01 · top of the page"
        title="Hero"
        description="The first screen: your name and portrait, the role line that cycles under it, the copy, the social row and the résumé button. Two versions of the layout exist and exactly one of them ships."
      />

      <div className="sec-strip">
        <div className="sec-mark" aria-hidden="true">01</div>
        <div className="sec-anchor">
          <span>#hero</span>
          <a href={`${SITE}/#hero`} target="_blank" rel="noreferrer">
            open on the site <IconArrowUpRight size={11} className="nudge" />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">the social row also draws in Contact and the footer</span>
          <span className="chip">the résumé URL also answers the terminal&rsquo;s resume</span>
          <span className="chip">your name also fills the tab title</span>
        </div>
      </div>

      <HeroSections
        titles={titles.map((t) => ({ id: t.id, title: t.title, sortOrder: t.sortOrder, version: t.version }))}
        badges={badges.map((b) => ({ id: b.id, name: b.name, iconKey: b.iconKey, sortOrder: b.sortOrder, version: b.version }))}
        content={content.map((c) => ({
          id: c.id, version: c.version, intro: c.intro, tagline: c.tagline, live: c.live,
        }))}
        socialLinks={socialLinks.map((l) => ({
          id: l.id, name: l.name, href: l.href, iconKey: l.iconKey, detail: l.detail,
          sortOrder: l.sortOrder, version: l.version,
        }))}
        config={config}
        resumeUrl={cfg.get("resumeUrl") ?? ""}
        availabilityStatus={cfg.get("availabilityStatus") ?? ""}
        totalSkills={totalSkills}
      />
    </div>
  );
}
