import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconPlus, IconFolderCode, IconPhoto } from "@tabler/icons-react";
import { PreviewFrame, ProjectsPreview } from "@/components/preview";
import { ProjectGrid } from "./grid";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, skills: { select: { name: true } } },
  });

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 05"
        title="Projects"
        description="The case-study cards on the portfolio — cover art, stack and the repo/demo links."
      >
        <Link href="/projects/new">
          <Button size="sm"><IconPlus size={14} /> Add project</Button>
        </Link>
      </PageHeader>

      {projects.length > 0 && (
        <div className="card-h" style={{ border: "none", padding: "0 2px 10px" }}>
          <span className="card-t">All projects</span>
          <span className="card-n">/ {String(projects.length).padStart(2, "0")}</span>
          <div className="sp" />
          <span className="hint">
            <IconPhoto size={13} /> Drag a card by its grip to reorder — position one leads the section
          </span>
        </div>
      )}

      <ProjectGrid
        projects={projects.map((p) => ({
          id: p.id,
          title: p.title,
          summary: p.summary,
          github: p.github,
          live: p.live,
          logoUrl: p.logoUrl,
          images: p.images,
          bulletCount: p.bullets.length,
          skills: p.skills.map((s) => s.name),
        }))}
      />

      {projects.length === 0 && (
        <Card>
          <div className="empty">
            <div className="empty-ic"><IconFolderCode size={19} stroke={1.5} /></div>
            <b>No projects yet</b>
            <span>Section 05 stays hidden until the first project lands here.</span>
            <Link href="/projects/new" style={{ marginTop: 4 }}>
              <Button size="sm"><IconPlus size={14} /> Add project</Button>
            </Link>
          </div>
        </Card>
      )}

      <PreviewFrame label="Projects Preview">
        <ProjectsPreview projects={projects.map(p => ({ title: p.title, summary: p.summary, github: p.github, live: p.live, bullets: p.bullets.map(b => b.content), technologies: p.skills.map(s => s.name) }))} />
      </PreviewFrame>
    </div>
  );
}
