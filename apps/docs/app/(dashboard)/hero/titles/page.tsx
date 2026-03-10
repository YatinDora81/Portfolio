import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { PreviewFrame } from "@/components/preview";
import { HeroPreview } from "@/components/preview";
import { HeroTitlesTable } from "./table";

export default async function HeroTitlesPage() {
  const [titles, skillBadges, socialLinks, siteConfigRows] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.heroSkillBadge.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.siteConfig.findMany(),
  ]);

  const config = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const name = config.get("name") ?? "Yatin";
  const tagline = config.get("tagline") ?? "";
  const intro = config.get("intro") ?? "";
  const avatarUrl = config.get("avatarUrl") ?? "";

  return (
    <div>
      <PageHeader title="Hero Titles" description="Rotating titles in the hero section" />
      <HeroTitlesTable titles={titles.map(t => ({ id: t.id, title: t.title, sortOrder: t.sortOrder }))} />
      <PreviewFrame label="Hero Preview">
        <HeroPreview
          titles={titles.map(t => t.title)}
          name={name}
          tagline={tagline}
          intro={intro}
          skills={skillBadges.map(b => ({ name: b.name }))}
          socialLinks={socialLinks.map(l => ({ name: l.name }))}
          avatarUrl={avatarUrl || undefined}
        />
      </PreviewFrame>
    </div>
  );
}
