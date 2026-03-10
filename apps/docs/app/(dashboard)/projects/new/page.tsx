import { prisma } from "db";
import { ProjectForm } from "../form";

export default async function NewProjectPage() {
  const allSkills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });
  return <ProjectForm allSkills={allSkills.map(s => ({ id: s.id, name: s.name }))} />;
}
