import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { SkillsTable } from "./table";
import { PreviewFrame, SkillsPreview } from "@/components/preview";

export default async function SkillsPage() {
  const skills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <div className="view">
      <PageHeader
        eyebrow="section 03"
        title="Skills"
        description="Your toolkit. Visible skills fill the grid on the site; hidden ones stay available as tags on projects and experience."
      />
      <SkillsTable skills={skills.map(s => ({ id: s.id, name: s.name, iconKey: s.iconKey, show: s.show, sortOrder: s.sortOrder }))} />
      <PreviewFrame label="Skills Preview">
        <SkillsPreview skills={skills.filter(s => s.show).map(s => ({ name: s.name }))} />
      </PreviewFrame>
    </div>
  );
}
