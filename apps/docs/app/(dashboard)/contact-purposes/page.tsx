import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { ContactPurposesTable } from "./table";
import { PreviewFrame, ContactPreview } from "@/components/preview";

export default async function ContactPurposesPage() {
  const [purposes, socialLinks, siteConfigs] = await Promise.all([
    prisma.contactPurpose.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.siteConfig.findMany(),
  ]);

  const cfg = new Map(siteConfigs.map(c => [c.key, c.value]));

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 08 · contact form"
        title="Contact purposes"
        description="The chips a visitor picks from before writing you a message."
      />
      <ContactPurposesTable purposes={purposes.map(p => ({ id: p.id, label: p.label, emoji: p.emoji, sortOrder: p.sortOrder }))} />
      <PreviewFrame label="Contact Preview">
        <ContactPreview
          purposes={purposes.map(p => ({ label: p.label, emoji: p.emoji }))}
          socialLinks={socialLinks.map(l => ({ name: l.name }))}
          availabilityStatus={cfg.get("availabilityStatus") || ""}
          availabilityDetail={cfg.get("availabilityDetail") || ""}
        />
      </PreviewFrame>
    </div>
  );
}
