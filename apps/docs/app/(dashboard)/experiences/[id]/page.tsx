import { prisma } from "db";
import { notFound } from "next/navigation";
import { utcToMonthInput } from "@/lib/lifecycle";
import { ExperienceForm } from "../form";

export default async function EditExperiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const experience = await prisma.experience.findUnique({
    where: { id },
    include: {
      bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      skills: { orderBy: { sortOrder: "asc" }, select: { skillId: true } },
    },
  });
  if (!experience) notFound();

  const allSkills = await prisma.skill.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

  return (
    <ExperienceForm
      experience={{
        id: experience.id,
        company: experience.company,
        position: experience.position,
        location: experience.location,
        startedOn: utcToMonthInput(experience.startedOn),
        endedOn: experience.endedOn ? utcToMonthInput(experience.endedOn) : null,
        website: experience.website,
        logoUrl: experience.logoUrl,
        visibleBullets: experience.visibleBullets,
        skillIds: experience.skills.map(s => s.skillId),
        bullets: experience.bullets.map(b => ({ id: b.id, content: b.content, sortOrder: b.sortOrder })),
      }}
      allSkills={allSkills.map(s => ({ id: s.id, name: s.name }))}
    />
  );
}
