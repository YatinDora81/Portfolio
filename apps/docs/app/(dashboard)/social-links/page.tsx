import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { PreviewFrame } from "@/components/preview";
import { HeroPreview } from "@/components/preview";
import { SocialLinksTable } from "./table";

export default async function SocialLinksPage() {
  const [titles, skillBadges, links, siteConfigRows] = await Promise.all([
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
      <PageHeader title="Social Links" description="Links shown in hero, contact, and footer" />
      <SocialLinksTable links={links.map(l => ({ id: l.id, name: l.name, href: l.href, iconKey: l.iconKey, detail: l.detail, sortOrder: l.sortOrder }))} />
      <PreviewFrame label="Hero Preview">
        <HeroPreview
          titles={titles.map(t => t.title)}
          name={name}
          tagline={tagline}
          intro={intro}
          skills={skillBadges.map(b => ({ name: b.name }))}
          socialLinks={links.map(l => ({ name: l.name }))}
          avatarUrl={avatarUrl || undefined}
        />
      </PreviewFrame>
    </div>
  );
}
