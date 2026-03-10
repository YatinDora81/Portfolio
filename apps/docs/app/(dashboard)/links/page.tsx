import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { PreviewFrame, LinksPreview } from "@/components/preview";
import { SocialLinksTable } from "../social-links/table";
import { ResumeForm } from "./resume-form";

export default async function LinksPage() {
  const [links, siteConfigRows] = await Promise.all([
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.siteConfig.findMany(),
  ]);

  const config = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  const resumeUrl = config.get("resumeUrl") ?? "";
  const contactEmail = config.get("contactEmail") ?? "";

  return (
    <div>
      <PageHeader
        title="Links"
        description="Manage all your external links — social profiles, resume, and more. Changes apply everywhere on your portfolio."
      />

      {/* Resume URL */}
      <Card className="mb-6">
        <h3 className="text-sm font-semibold mb-3">Resume / CV Link</h3>
        <p className="text-xs text-muted-foreground mb-3">
          This link is used for the &quot;Resume / CV&quot; button in the hero section.
        </p>
        <ResumeForm resumeUrl={resumeUrl} />
      </Card>

      {/* Social Links */}
      <h3 className="text-sm font-semibold mb-3">Social Links</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Displayed in the hero section, contact sidebar, and footer.
      </p>
      <SocialLinksTable
        links={links.map((l) => ({
          id: l.id,
          name: l.name,
          href: l.href,
          iconKey: l.iconKey,
          detail: l.detail,
          sortOrder: l.sortOrder,
        }))}
      />

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
