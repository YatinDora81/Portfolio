import { prisma } from "db";
import { ExperienceForm } from "../form";

export default async function NewExperiencePage() {
  const allSkills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });
  return <ExperienceForm allSkills={allSkills.map(s => ({ id: s.id, name: s.name }))} />;
}
