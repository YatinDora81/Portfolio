import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { StagedHeroPreview } from "@/components/preview/staged";
import { SocialLinksTable } from "./table";
import { RefreshGithubButton } from "./refresh-github";

export default async function SocialLinksPage() {
  const [titles, skillBadges, links, content, siteConfigRows, totalSkills] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroContent.findMany(),
    prisma.siteConfig.findMany(),
    prisma.skill.count({ where: { show: true } }),
  ]);

  const config = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const name = config.get("name") ?? "Yatin";
  const avatarUrl = config.get("avatarUrl") ?? "";
  const availabilityStatus = config.get("availabilityStatus") ?? "";
  // Edited on /site-config, read-only here — same rule as the name and avatar.
  const dotColor = config.get("heroDotColor") ?? "";
  const dotPulse = (config.get("heroDotPulse") ?? "on") !== "off";
  // Same comma-split as apps/web/app/lib/data.ts; `cdnUrl` runs inside the preview.
  const heroPhotos = (config.get("heroPhotos") ?? "").split(",").map(p => p.trim()).filter(Boolean);

  return (
    <div className="view">
      <PageHeader
        eyebrow="site-wide · hero + footer"
        title="Social links"
        description="Profiles rendered in the hero, contact block and footer. Order here is the order on site."
      />
      <SocialLinksTable links={links.map(l => ({ id: l.id, name: l.name, href: l.href, iconKey: l.iconKey, detail: l.detail, sortOrder: l.sortOrder, version: l.version }))} />
      {/* Only with a GitHub row to read a handle from — the site resolves the
          handle from exactly that row, so without one the button has nothing to
          refresh. */}
      {links.some(l => l.iconKey === "github") && <RefreshGithubButton />}
      {/* `iconKey` is the whole point of this page — the table above edits it,
          so the preview has to key its glyphs on it and not on the display
          name, or "LeetCode 2" draws a two-letter stand-in where the site
          draws the LeetCode mark. */}
      <StagedHeroPreview
        titles={titles.map(t => ({ id: t.id, title: t.title, version: t.version }))}
        badges={skillBadges.map(b => ({ id: b.id, name: b.name, version: b.version }))}
        socialLinks={links.map(l => ({ id: l.id, name: l.name, iconKey: l.iconKey, version: l.version }))}
        // No `version`: with no tab on this page the pane derives it, so a staged
        // flip moves the pane instead of leaving it arguing with its own chip.
        content={content.map(c => ({ id: c.id, version: c.version, intro: c.intro, tagline: c.tagline, live: c.live }))}
        name={name}
        avatarUrl={avatarUrl || undefined}
        photos={heroPhotos}
        availabilityStatus={availabilityStatus}
        dotColor={dotColor}
        dotPulse={dotPulse}
        totalSkills={totalSkills}
      />
    </div>
  );
}
