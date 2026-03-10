import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { PreviewFrame } from "@/components/preview";
import { HeroPreview } from "@/components/preview";
import { HeroSkillBadgesTable } from "./table";

export default async function HeroSkillBadgesPage() {
  const [titles, badges, socialLinks, siteConfigRows] = await Promise.all([
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
      <PageHeader title="Hero Skill Badges" description="Inline skill badges in the hero bio" />
      <HeroSkillBadgesTable badges={badges.map(b => ({ id: b.id, name: b.name, iconKey: b.iconKey, sortOrder: b.sortOrder }))} />
      <PreviewFrame label="Hero Preview">
        <HeroPreview
          titles={titles.map(t => t.title)}
          name={name}
          tagline={tagline}
          intro={intro}
          skills={badges.map(b => ({ name: b.name }))}
          socialLinks={socialLinks.map(l => ({ name: l.name }))}
          avatarUrl={avatarUrl || undefined}
        />
      </PreviewFrame>
    </div>
  );
}
