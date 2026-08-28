import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { SkillsTable } from "./table";
import { StagedSkillsPreview } from "@/components/preview/staged";
import { IconArrowUpRight } from "@tabler/icons-react";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

export default async function SkillsPage() {
  const skills = await prisma.skill.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 03"
        title="Skills"
        description="The periodic table. Published skills fill the grid in the order below; hidden ones stay in the vocabulary that tags projects and roles."
      />

      {/* the ordinal, the anchor, and the sections this also changes */}
      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">03</span>
        <div className="sec-anchor">
          <a href={`${SITE}/#skills`} target="_blank" rel="noreferrer">
            #skills <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">also feeds the hero&rsquo;s &ldquo;+N more&rdquo; chip</span>
          <span className="chip">also the tag list on Experience and Projects</span>
        </div>
      </div>

      <SkillsTable skills={skills.map(s => ({ id: s.id, name: s.name, iconKey: s.iconKey, show: s.show, sortOrder: s.sortOrder }))} />
      {/* hidden skills go through too; the wrapper applies show later */}
      <StagedSkillsPreview skills={skills.map(s => ({ id: s.id, name: s.name, show: s.show }))} />
    </div>
  );
}
