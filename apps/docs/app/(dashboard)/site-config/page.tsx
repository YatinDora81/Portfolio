import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { SiteConfigForm } from "./form";
import { PreviewFrame, HeroPreview } from "@/components/preview";

const CONFIG_KEYS = [
  { key: "name", label: "Name", description: "First name in hero heading" },
  { key: "tagline", label: "Tagline", description: "Sentence after skill badges in hero" },
  { key: "intro", label: "Intro", description: "Text before skill badges" },
  { key: "avatarUrl", label: "Avatar URL", description: "Path to avatar image" },
  { key: "navbarLogo", label: "Navbar Logo", description: "Logo text in navbar" },
  { key: "contactEmail", label: "Contact Email", description: "Email in contact form mailto" },
  { key: "availabilityStatus", label: "Availability Status", description: "Status text in contact" },
  { key: "availabilityDetail", label: "Availability Detail", description: "Detail below status" },
  { key: "copyrightName", label: "Copyright Name", description: "Name in footer copyright" },
];

export default async function SiteConfigPage() {
  const [configs, titles, skillBadges, socialLinks] = await Promise.all([
    prisma.siteConfig.findMany(),
    prisma.heroTitle.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.heroSkillBadge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);

  const configMap = Object.fromEntries(configs.map(c => [c.key, c.value]));
  // Same parse as apps/web/app/lib/data.ts — one comma-separated SiteConfig row.
  // `cdnUrl` is applied inside the preview, so the raw paths go through.
  const heroPhotos = (configMap["heroPhotos"] ?? "").split(",").map(p => p.trim()).filter(Boolean);

  return (
    <div className="view">
      <PageHeader
        eyebrow="site-wide"
        title="Site Config"
        description="The strings the whole portfolio reads from — hero copy, avatar, contact and footer."
      />
      <SiteConfigForm configs={CONFIG_KEYS.map(k => ({ ...k, value: configMap[k.key] || "" }))} />
      <PreviewFrame label="Hero Preview (affected by config changes)">
        {/* `availabilityStatus` is CONFIG_KEY #7, edited in the form directly
            above — not passing it left the pill reading "Availability not set"
            next to the field that sets it. `iconKey` and `heroPhotos` are the
            same story: already loaded here, and the hero keys its glyphs and
            its photo deck on them. */}
        <HeroPreview
          titles={titles.map(t => t.title)}
          name={configMap["name"] || "Yatin"}
          tagline={configMap["tagline"] || ""}
          intro={configMap["intro"] || ""}
          skills={skillBadges.map(s => ({ name: s.name }))}
          socialLinks={socialLinks.map(l => ({ name: l.name, iconKey: l.iconKey }))}
          avatarUrl={configMap["avatarUrl"] || ""}
          photos={heroPhotos}
          availabilityStatus={configMap["availabilityStatus"] || ""}
        />
      </PreviewFrame>
    </div>
  );
}
