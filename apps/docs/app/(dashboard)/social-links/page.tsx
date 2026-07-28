import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { StagedHeroPreview } from "@/components/preview/staged";
import { SocialLinksTable } from "./table";

export default async function SocialLinksPage() {
  const [titles, skillBadges, links, siteConfigRows] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.siteConfig.findMany(),
  ]);

  const config = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const name = config.get("name") ?? "Yatin";
  const tagline = config.get("tagline") ?? "";
  const intro = config.get("intro") ?? "";
  const avatarUrl = config.get("avatarUrl") ?? "";
  const availabilityStatus = config.get("availabilityStatus") ?? "";
  // Same comma-split as apps/web/app/lib/data.ts; `cdnUrl` runs inside the preview.
  const heroPhotos = (config.get("heroPhotos") ?? "").split(",").map(p => p.trim()).filter(Boolean);

  return (
    <div className="view">
      <PageHeader
        eyebrow="site-wide · hero + footer"
        title="Social links"
        description="Profiles rendered in the hero, contact block and footer. Order here is the order on site."
      />
      <SocialLinksTable links={links.map(l => ({ id: l.id, name: l.name, href: l.href, iconKey: l.iconKey, detail: l.detail, sortOrder: l.sortOrder }))} />
      {/* `iconKey` is the whole point of this page — the table above edits it,
          so the preview has to key its glyphs on it and not on the display
          name, or "LeetCode 2" draws a two-letter stand-in where the site
          draws the LeetCode mark. */}
      <StagedHeroPreview
        titles={titles.map(t => ({ id: t.id, title: t.title }))}
        badges={skillBadges.map(b => ({ id: b.id, name: b.name }))}
        socialLinks={links.map(l => ({ id: l.id, name: l.name, iconKey: l.iconKey }))}
        name={name}
        tagline={tagline}
        intro={intro}
        avatarUrl={avatarUrl || undefined}
        photos={heroPhotos}
        availabilityStatus={availabilityStatus}
      />
    </div>
  );
}
