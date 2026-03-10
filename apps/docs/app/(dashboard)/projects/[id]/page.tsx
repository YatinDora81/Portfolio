import { prisma } from "db";
import { notFound } from "next/navigation";
import { ProjectForm } from "../form";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { id: true } } },
  });
  if (!project) notFound();

  const allSkills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <ProjectForm
      project={{
        id: project.id,
        title: project.title,
        summary: project.summary,
        github: project.github,
        live: project.live,
        images: project.images,
        skillIds: project.skills.map(s => s.id),
        bullets: project.bullets.map(b => ({ id: b.id, content: b.content, sortOrder: b.sortOrder })),
      }}
      allSkills={allSkills.map(s => ({ id: s.id, name: s.name }))}
    />
  );
}
