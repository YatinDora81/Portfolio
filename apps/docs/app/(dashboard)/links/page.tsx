import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { PreviewFrame, LinksPreview } from "@/components/preview";
import { SocialLinksList } from "./social-links-list";
import { ResumeForm } from "./resume-form";
import { IconArrowUpRight } from "@tabler/icons-react";

export default async function LinksPage() {
  const [links, siteConfigRows] = await Promise.all([
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.siteConfig.findMany(),
  ]);

  const config = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const resumeUrl = config.get("resumeUrl") ?? "";
  const contactEmail = config.get("contactEmail") ?? "";

  return (
    <div className="view">
      <PageHeader
        eyebrow="site-wide · hero + footer"
        title="Links"
        description="Every outbound link on the portfolio — social profiles and the resume. Changes apply everywhere."
      />

      <div className="grid gap-3">
        {/* Resume URL */}
        <Card flush>
          <CardHead
            title="Resume / CV"
            right={
              resumeUrl ? (
                <a className="btn ghost" href={resumeUrl} target="_blank" rel="noopener noreferrer">
                  <IconArrowUpRight size={13} stroke={1.5} className="nudge" /> Open
                </a>
              ) : undefined
            }
          />
          <div className="card-b">
            <ResumeForm resumeUrl={resumeUrl} />
          </div>
        </Card>

        {/* Social Links */}
        <SocialLinksList
          links={links.map((l) => ({
            id: l.id,
            name: l.name,
            href: l.href,
            iconKey: l.iconKey,
            detail: l.detail,
            sortOrder: l.sortOrder,
          }))}
        />
      </div>

      {/* Preview */}
      <PreviewFrame label="Links Preview — How they appear across your portfolio">
        <LinksPreview
          socialLinks={links.map((l) => ({ name: l.name, href: l.href, iconKey: l.iconKey, detail: l.detail }))}
          resumeUrl={resumeUrl}
          contactEmail={contactEmail}
        />
      </PreviewFrame>
    </div>
  );
}
