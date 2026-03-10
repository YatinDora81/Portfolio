"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function createSkill(formData: FormData) {
  const count = await prisma.skill.count();
  await prisma.skill.create({
    data: {
      name: formData.get("name") as string,
      iconKey: formData.get("iconKey") as string,
      show: formData.get("show") === "true",
      sortOrder: count,
    },
  });
  revalidatePath("/skills");
  revalidatePortfolio();
}

export async function updateSkill(id: string, formData: FormData) {
  await prisma.skill.update({
    where: { id },
    data: {
      name: formData.get("name") as string,
      iconKey: formData.get("iconKey") as string,
      show: formData.get("show") === "true",
    },
  });
  revalidatePath("/skills");
  revalidatePortfolio();
}

export async function toggleSkillVisibility(id: string, show: boolean) {
  await prisma.skill.update({ where: { id }, data: { show } });
  revalidatePath("/skills");
  revalidatePortfolio();
}

export async function deleteSkill(id: string) {
  await prisma.skill.delete({ where: { id } });
  revalidatePath("/skills");
  revalidatePortfolio();
}
