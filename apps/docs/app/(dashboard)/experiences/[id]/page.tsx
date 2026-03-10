import { prisma } from "db";
import { notFound } from "next/navigation";
import { ExperienceForm } from "../form";

export default async function EditExperiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const experience = await prisma.experience.findUnique({
    where: { id },
    include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { id: true } } },
  });
  if (!experience) notFound();

  const allSkills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <ExperienceForm
      experience={{
        id: experience.id,
        company: experience.company,
        position: experience.position,
        location: experience.location,
        startDate: experience.startDate,
        endDate: experience.endDate,
        isCurrent: experience.isCurrent,
        website: experience.website,
        skillIds: experience.skills.map(s => s.id),
        bullets: experience.bullets.map(b => ({ id: b.id, content: b.content, sortOrder: b.sortOrder })),
      }}
      allSkills={allSkills.map(s => ({ id: s.id, name: s.name }))}
    />
  );
}
