import { prisma } from "db";
import { IconArrowUpRight } from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { keysFor, DEFAULTS } from "@/lib/site-config-keys";
import { readGithubLedger } from "./github-ledger";
import { GithubTile } from "./github-tile";
import { ContactSections } from "./sections";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/+$/, "");

export default async function ContactPurposesPage() {
  const [purposes, socialLinks, siteConfigs] = await Promise.all([
    prisma.contactPurpose.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.siteConfig.findMany(),
  ]);

  const ledger = await readGithubLedger(socialLinks.map((l) => ({ iconKey: l.iconKey, href: l.href })));

  const cfg = new Map(siteConfigs.map((c) => [c.key, c.value]));
  const config = Object.fromEntries(
    keysFor("contact").map((k) => [k, cfg.get(k) ?? DEFAULTS[k] ?? ""])
  );

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 08 · contact form"
        title="Contact"
        description="The last thing on the page and the only one that answers back: the chips a visitor picks from, the address the section is built around, and the line that says how fast you reply."
      />

      <div className="sec-strip">
        <div className="sec-mark" aria-hidden="true">08</div>
        <div className="sec-anchor">
          <span>#contact</span>
          <a href={`${SITE}/#contact`} target="_blank" rel="noreferrer">
            open on the site <IconArrowUpRight size={11} className="nudge" />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">the status is also the hero&rsquo;s availability pill</span>
          <span className="chip">messages land in the Inbox</span>
        </div>
      </div>

      <ContactSections
        purposes={purposes.map((p) => ({ id: p.id, label: p.label, emoji: p.emoji, sortOrder: p.sortOrder }))}
        socialLinks={socialLinks.map((l) => ({ id: l.id, name: l.name, iconKey: l.iconKey, detail: l.detail }))}
        config={config}
        resumeUrl={cfg.get("resumeUrl") ?? ""}
        githubTile={
          <GithubTile ledger={ledger} hasGithubRow={socialLinks.some((l) => l.iconKey === "github")} />
        }
      />
    </div>
  );
}
