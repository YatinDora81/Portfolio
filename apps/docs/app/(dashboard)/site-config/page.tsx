import { prisma } from "db";
import { FLAG_KEYS, flagValue, type FlagMap } from "@repo/shared/flags";
import { PageHeader } from "@/components/shared/page-header";
import { SiteChromeForm } from "./form";
import { KEYS, DEFAULTS, keysFor, isUnclaimed, type ConfigOwner } from "@/lib/site-config-keys";

const OWNERS: Record<Exclude<ConfigOwner, "chrome">, { label: string; href: string }> = {
  background: { label: "Background", href: "/background" },
  hero: { label: "Hero", href: "/hero" },
  contact: { label: "Contact", href: "/contact-purposes" },
  cat: { label: "Cat", href: "/cat" },
  projects: { label: "Projects", href: "/projects" },
};

export default async function SiteConfigPage() {
  const [configs, visibleBlogs, flagRows] = await Promise.all([
    prisma.siteConfig.findMany(),
    prisma.blog.count({ where: { show: true } }),
    prisma.featureFlag.findMany(),
  ]);

  const flags: FlagMap = Object.fromEntries(flagRows.map(f => [f.key, f.enabled]));
  const sections = {
    skills: flagValue(flags, FLAG_KEYS.SECTION_SKILLS),
    experience: flagValue(flags, FLAG_KEYS.SECTION_EXPERIENCE),
    projects: flagValue(flags, FLAG_KEYS.SECTION_PROJECTS),
    blogs: flagValue(flags, FLAG_KEYS.SECTION_BLOGS),
    contact: flagValue(flags, FLAG_KEYS.SECTION_CONTACT),
  };

  const configMap = Object.fromEntries(configs.map(c => [c.key, c.value]));
  const chromeKeys = keysFor("chrome");
  const unclaimedKeys = configs.map(c => c.key).filter(isUnclaimed).sort();

  const values = Object.fromEntries(
    [...chromeKeys, ...unclaimedKeys].map(k => [k, configMap[k] ?? DEFAULTS[k] ?? ""])
  );

  return (
    <div className="view">
      <PageHeader
        eyebrow="site-wide · navbar + footer"
        title="Site chrome"
        description="The frame around every page. Everything a section renders is edited on that section now — these are the rows with no section to belong to."
      />
      <SiteChromeForm
        chromeKeys={chromeKeys}
        unclaimedKeys={unclaimedKeys}
        values={values}
        moved={Object.entries(KEYS)
          .filter(([, def]) => def.owner !== "chrome" && !def.legacy)
          .map(([key, def]) => {
            const at = OWNERS[def.owner as Exclude<ConfigOwner, "chrome">];
            return {
              key,
              label: def.label,
              value: configMap[key] ?? DEFAULTS[key] ?? "",
              owner: at.label,
              href: at.href,
            };
          })}
        hasBlogs={visibleBlogs > 0}
        sections={sections}
      />
    </div>
  );
}
