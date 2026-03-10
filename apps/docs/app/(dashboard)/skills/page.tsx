import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { SkillsTable } from "./table";
import { PreviewFrame, SkillsPreview } from "@/components/preview";

export default async function SkillsPage() {
  const skills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <div>
      <PageHeader title="Skills" description="All skills — toggle visibility for the skills grid" />
      <SkillsTable skills={skills.map(s => ({ id: s.id, name: s.name, iconKey: s.iconKey, show: s.show, sortOrder: s.sortOrder }))} />
      <PreviewFrame label="Skills Preview">
        <SkillsPreview skills={skills.filter(s => s.show).map(s => ({ name: s.name }))} />
      </PreviewFrame>
    </div>
  );
}
