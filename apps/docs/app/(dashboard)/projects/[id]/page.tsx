import { prisma } from "db";
import { notFound } from "next/navigation";
import { BUILD_NAG_DAYS, daysSince } from "@/lib/lifecycle";
import { ProjectForm } from "../form";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      skills: { orderBy: { sortOrder: "asc" }, select: { skillId: true } },
      gallery: {
        orderBy: { sortOrder: "asc" },
        select: { externalUrl: true, asset: { select: { url: true } } },
      },
      milestones: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!project) notFound();

  const allSkills = await prisma.skill.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

  const doing = project.milestones.filter((m) => m.state === "DOING");
  const only = doing.length === 1 ? doing[0]! : null;
  const stale = only ? daysSince(only.updatedAt) : 0;

  return (
    <ProjectForm
      project={{
        id: project.id,
        title: project.title,
        summary: project.summary,
        github: project.github,
        live: project.live,
        logoUrl: project.logoUrl,
        images: project.gallery.map(img => img.externalUrl ?? img.asset?.url ?? "").filter(Boolean),
        skillIds: project.skills.map(s => s.skillId),
        bullets: project.bullets.map(b => ({ id: b.id, content: b.content, sortOrder: b.sortOrder })),
        status: project.status,
        publishAtIso: project.publishAt?.toISOString() ?? null,
        buildState: project.buildState,
        buildVersion: project.buildVersion,
        etaLabel: project.etaLabel,
        milestones: project.milestones.map(m => ({
          id: m.id,
          label: m.label,
          state: m.state,
          sortOrder: m.sortOrder,
        })),
        neglect:
          only && stale >= BUILD_NAG_DAYS
            ? `${only.label} has been doing for ${stale} days.`
            : null,
      }}
      allSkills={allSkills.map(s => ({ id: s.id, name: s.name }))}
    />
  );
}
