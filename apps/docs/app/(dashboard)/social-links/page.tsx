import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { StagedHeroPreview } from "@/components/preview/staged";
import { SocialLinksTable } from "./table";

export default async function SocialLinksPage() {
  const [titles, skillBadges, links, siteConfigRows, totalSkills] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.siteConfig.findMany(),
    prisma.skill.count({ where: { show: true } }),
  ]);

  const config = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const name = config.get("name") ?? "Yatin";
  const avatarUrl = config.get("avatarUrl") ?? "";
  const availabilityStatus = config.get("availabilityStatus") ?? "";
  // No tab on this page — the pane shows whichever hero is live, and the copy
  // resolves the way apps/web/app/lib/data.ts resolves it.
  const heroVersion = config.get("heroVersion") === "v1" ? "v1" : "v2";
  const tagline = heroVersion === "v2"
    ? config.get("taglineV2") || config.get("tagline") || ""
    : config.get("tagline") || "";
  const intro = heroVersion === "v2"
    ? config.get("introV2") || config.get("intro") || ""
    : config.get("intro") || "";
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
      {/* `iconKey` is the whole point of this page — the table above edits it,
          so the preview has to key its glyphs on it and not on the display
          name, or "LeetCode 2" draws a two-letter stand-in where the site
          draws the LeetCode mark. */}
      <StagedHeroPreview
        version={heroVersion}
        titles={titles.map(t => ({ id: t.id, title: t.title, version: t.version }))}
        badges={skillBadges.map(b => ({ id: b.id, name: b.name, version: b.version }))}
        socialLinks={links.map(l => ({ id: l.id, name: l.name, iconKey: l.iconKey, version: l.version }))}
        name={name}
        tagline={tagline}
        intro={intro}
        avatarUrl={avatarUrl || undefined}
        photos={heroPhotos}
        availabilityStatus={availabilityStatus}
        totalSkills={totalSkills}
      />
    </div>
  );
}
