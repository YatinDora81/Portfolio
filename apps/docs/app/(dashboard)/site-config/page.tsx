import { prisma } from "db";
import { FLAG_KEYS, flagValue, type FlagMap } from "@repo/shared/flags";
import { PageHeader } from "@/components/shared/page-header";
import { SiteChromeForm } from "./form";
import { KEYS, DEFAULTS, keysFor, isUnclaimed, type ConfigOwner } from "@/lib/site-config-keys";

/**
 * Site chrome — what wraps the page rather than what fills it.
 *
 * Nine of this page's eleven keys moved to the section that renders them. Two
 * things are left behind, and the second is the important one:
 *
 *   1. `owner: "chrome"` — navbarLogo (Navbar) and copyrightName (Footer).
 *   2. The safety net. This page reads the WHOLE siteConfig table and hands
 *      ConfigCard every row the registry does not know about, so a key added by
 *      a migration — or one whose owning section is deleted — can never become
 *      uneditable. That logic was dead code while page.tsx passed a whitelist;
 *      it is load-bearing now.
 */

/** Where a key went, for the read-only wayfinding list at the bottom. */
const OWNERS: Record<Exclude<ConfigOwner, "chrome">, { label: string; href: string }> = {
  hero: { label: "Hero", href: "/hero" },
  contact: { label: "Contact", href: "/contact-purposes" },
  cat: { label: "Cat", href: "/cat" },
  projects: { label: "Projects", href: "/projects" },
};

export default async function SiteConfigPage() {
  const [configs, visibleBlogs, flagRows] = await Promise.all([
    prisma.siteConfig.findMany(),
    // The navbar drops its Blogs link when nothing is published, so the chrome
    // preview has to know — otherwise it draws a link the site does not.
    prisma.blog.count({ where: { show: true } }),
    // Read from the table, not a cached helper: a switch flipped a minute ago has to show up.
    prisma.featureFlag.findMany(),
  ]);

  const flags: FlagMap = Object.fromEntries(flagRows.map(f => [f.key, f.enabled]));
  // `flagValue` fails open to the registry default, which is what the site serves.
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
          // `legacy` rows are claimed purely so the safety net skips them —
          // nothing reads them, so pointing the reader at an editor would be
          // sending them somewhere that changes nothing.
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
