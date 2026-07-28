import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { StagedHeroPreview } from "@/components/preview/staged";
import { HeroTitlesTable } from "./table";

export default async function HeroTitlesPage() {
  const [titles, skillBadges, socialLinks, siteConfigRows] = await Promise.all([
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
        eyebrow="section 01 · top of the page"
        title="Hero titles"
        description="The line that cycles under your name in the hero. Order here is the order visitors see."
      />
      <HeroTitlesTable titles={titles.map(t => ({ id: t.id, title: t.title, sortOrder: t.sortOrder }))} />
      <StagedHeroPreview
        titles={titles.map(t => ({ id: t.id, title: t.title }))}
        badges={skillBadges.map(b => ({ id: b.id, name: b.name }))}
        socialLinks={socialLinks.map(l => ({ id: l.id, name: l.name, iconKey: l.iconKey }))}
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
