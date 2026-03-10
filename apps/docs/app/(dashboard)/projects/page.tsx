import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteProject } from "@/lib/actions/projects";
import { IconPlus, IconEdit } from "@tabler/icons-react";
import { PreviewFrame, ProjectsPreview } from "@/components/preview";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { sortOrder: "asc" },
    include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { name: true } } },
  });

  return (
    <div>
      <PageHeader title="Projects" description="Portfolio project entries">
        <Link href="/projects/new">
          <Button size="sm"><IconPlus size={16} /> Add Project</Button>
        </Link>
      </PageHeader>
      <div className="space-y-4">
        {projects.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.summary}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {p.skills.map((s) => (
                    <Badge key={s.name} variant="outline">{s.name}</Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{p.bullets.length} bullet points</p>
              </div>
              <div className="flex gap-1">
                <Link href={`/projects/${p.id}`}>
                  <Button variant="ghost" size="sm"><IconEdit size={16} /></Button>
                </Link>
                <DeleteButton label={`"${p.title}"`} onDelete={async () => { "use server"; await deleteProject(p.id); }} />
              </div>
            </div>
          </Card>
        ))}
        {projects.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">No projects yet</Card>
        )}
      </div>
      <PreviewFrame label="Projects Preview">
        <ProjectsPreview projects={projects.map(p => ({ title: p.title, summary: p.summary, github: p.github, live: p.live, bullets: p.bullets.map(b => b.content), technologies: p.skills.map(s => s.name) }))} />
      </PreviewFrame>
    </div>
  );
}
