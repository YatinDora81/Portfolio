import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { SiteConfigForm } from "./form";

const CONFIG_KEYS = [
  { key: "name", label: "Name", description: "First name in hero heading" },
  { key: "avatarUrl", label: "Avatar URL", description: "Path to avatar image" },
  { key: "navbarLogo", label: "Navbar Logo", description: "Logo text in navbar" },
  { key: "contactEmail", label: "Contact Email", description: "Email in contact form mailto" },
  { key: "availabilityStatus", label: "Availability Status", description: "Status text in contact" },
  { key: "availabilityDetail", label: "Availability Detail", description: "Detail below status" },
  { key: "copyrightName", label: "Copyright Name", description: "Name in footer copyright" },
];

export default async function SiteConfigPage() {
  const [configs, titles, skillBadges, socialLinks, content, totalSkills] = await Promise.all([
    prisma.siteConfig.findMany(),
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroContent.findMany(),
    // The same count apps/web hands the hero, so v2's "+N more" chip previews
    // the number visitors actually see.
    prisma.skill.count({ where: { show: true } }),
  ]);

  const configMap = Object.fromEntries(configs.map(c => [c.key, c.value]));
  // Same parse as apps/web/app/lib/data.ts — one comma-separated SiteConfig row.
  // `cdnUrl` is applied inside the preview, so the raw paths go through.
  const heroPhotos = (configMap["heroPhotos"] ?? "").split(",").map(p => p.trim()).filter(Boolean);

  // The hero's copy and its live version are edited on /hero now, so this page
  // only needs the one version it is previewing — the version can no longer
  // change from here. A NULL SocialLink.version means "every version".
  const live = content.find(c => c.live) ?? content.find(c => c.version === "v2") ?? null;
  const version = live?.version === "v1" ? "v1" : "v2";
  const hero = {
    titles: titles.filter(t => t.version === version).map(t => t.title),
    skills: skillBadges.filter(b => b.version === version).map(b => ({ name: b.name })),
    socialLinks: socialLinks
      .filter(l => l.version == null || l.version === version)
      .map(l => ({ name: l.name, iconKey: l.iconKey })),
  };

  return (
    <div className="view">
      <PageHeader
        eyebrow="site-wide"
        title="Site Config"
        description="The strings the whole portfolio reads from — your name, avatar, contact and footer. The hero's own copy lives on the Hero page."
      />
      {/* `availabilityStatus`, `iconKey` and `heroPhotos` all ride along to the
          preview: the hero keys its glyphs on the icon key and its photo deck on
          those paths, and the pill is verbatim CMS copy edited on this page. */}
      <SiteConfigForm
        configs={CONFIG_KEYS.map(k => ({ ...k, value: configMap[k.key] || "" }))}
        liveHero={{ version, intro: live?.intro ?? "", tagline: live?.tagline ?? "" }}
        hero={hero}
        photos={heroPhotos}
        totalSkills={totalSkills}
      />
    </div>
  );
}
