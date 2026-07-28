import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { StagedHeroPreview } from "@/components/preview/staged";
import { HeroSections } from "./sections";

export default async function HeroPage() {
  // Both hero versions have rows in these tables, and the query stays unfiltered
  // so the tabs below can be populated without a second round trip.
  const [titles, badges, socialLinks, content, siteConfigRows, totalSkills] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroContent.findMany({ orderBy: { version: "asc" } }),
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
  const heroPhotos = (config.get("heroPhotos") ?? "").split(",").map((p) => p.trim()).filter(Boolean);

  const previewRows = {
    titles: titles.map((t) => ({ id: t.id, title: t.title, version: t.version })),
    badges: badges.map((b) => ({ id: b.id, name: b.name, version: b.version })),
    socialLinks: socialLinks.map((l) => ({ id: l.id, name: l.name, iconKey: l.iconKey, version: l.version })),
    content: content.map((c) => ({ id: c.id, version: c.version, intro: c.intro, tagline: c.tagline, live: c.live })),
  };

  const pane = (version: "v1" | "v2") => (
    <StagedHeroPreview
      version={version}
      {...previewRows}
      name={name}
      avatarUrl={avatarUrl || undefined}
      photos={heroPhotos}
      availabilityStatus={availabilityStatus}
      dotColor={dotColor}
      dotPulse={dotPulse}
      totalSkills={totalSkills}
    />
  );

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 01 · top of the page"
        title="Hero"
        description="Everything at the top of the page: your intro copy, the role line under your name and the skill badges beside it. Pick a version to edit — the copy, the rows and the switch deciding which version visitors see all commit together through the save bar."
      />
      <HeroSections
        titles={titles.map((t) => ({ id: t.id, title: t.title, sortOrder: t.sortOrder, version: t.version }))}
        badges={badges.map((b) => ({ id: b.id, name: b.name, iconKey: b.iconKey, sortOrder: b.sortOrder, version: b.version }))}
        content={content.map((c) => ({
          id: c.id, version: c.version, intro: c.intro, tagline: c.tagline, live: c.live,
        }))}
        preview={{ v1: pane("v1"), v2: pane("v2") }}
      />
    </div>
  );
}
