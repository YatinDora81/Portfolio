import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { SkillsTable } from "./table";
import { StagedSkillsPreview } from "@/components/preview/staged";

export default async function SkillsPage() {
  const skills = await prisma.skill.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return (
    <div className="view">
      <PageHeader
        eyebrow="section 03"
        title="Skills"
        description="Your toolkit. Visible skills fill the grid on the site; hidden ones stay available as tags on projects and experience."
      />
      <SkillsTable skills={skills.map(s => ({ id: s.id, name: s.name, iconKey: s.iconKey, show: s.show, sortOrder: s.sortOrder }))} />
      {/* Hidden skills go through too: the wrapper applies `show` after the
          staging overlay, so toggling one back on is visible before it saves. */}
      <StagedSkillsPreview skills={skills.map(s => ({ id: s.id, name: s.name, show: s.show }))} />
    </div>
  );
}
