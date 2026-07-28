import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { StagedHeroPreview } from "@/components/preview/staged";
import { HeroSkillBadgesTable } from "./table";

export default async function HeroSkillBadgesPage() {
  // Both hero versions have rows in these tables, and the query stays unfiltered
  // so the tabs below can be populated without a second round trip.
  const [titles, badges, socialLinks, siteConfigRows, totalSkills] = await Promise.all([
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
  const heroVersion = config.get("heroVersion") === "v1" ? "v1" : "v2";
  // Same comma-split as apps/web/app/lib/data.ts; `cdnUrl` runs inside the preview.
  const heroPhotos = (config.get("heroPhotos") ?? "").split(",").map(p => p.trim()).filter(Boolean);

  const previewRows = {
    titles: titles.map(t => ({ id: t.id, title: t.title, version: t.version })),
    badges: badges.map(b => ({ id: b.id, name: b.name, version: b.version })),
    socialLinks: socialLinks.map(l => ({ id: l.id, name: l.name, iconKey: l.iconKey, version: l.version })),
  };

  // The copy is per version too, with v2 falling back to v1's row — the same
  // resolution apps/web/app/lib/data.ts does.
  const pane = (version: "v1" | "v2") => (
    <StagedHeroPreview
      version={version}
      {...previewRows}
      name={name}
      tagline={version === "v2" ? config.get("taglineV2") || config.get("tagline") || "" : config.get("tagline") || ""}
      intro={version === "v2" ? config.get("introV2") || config.get("intro") || "" : config.get("intro") || ""}
      avatarUrl={avatarUrl || undefined}
      photos={heroPhotos}
      availabilityStatus={availabilityStatus}
      totalSkills={totalSkills}
    />
  );

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 01 · top of the page"
        title="Hero badges"
        description="The small skill badges under your name, in this order — set inline in v1's paragraph, listed as pills in v2."
      />
      <HeroSkillBadgesTable
        badges={badges.map(b => ({ id: b.id, name: b.name, iconKey: b.iconKey, sortOrder: b.sortOrder, version: b.version }))}
        liveVersion={heroVersion}
        preview={{ v1: pane("v1"), v2: pane("v2") }}
      />
    </div>
  );
}
