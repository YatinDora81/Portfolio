import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { ContactPurposesTable } from "./table";
import { PreviewFrame, ContactPreview } from "@/components/preview";

export default async function ContactPurposesPage() {
  const [purposes, socialLinks, siteConfigs] = await Promise.all([
    prisma.contactPurpose.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.siteConfig.findMany(),
  ]);

  const cfg = new Map(siteConfigs.map(c => [c.key, c.value]));

  return (
    <div>
      <PageHeader title="Contact Purposes" description="Purpose chips in the contact form" />
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
