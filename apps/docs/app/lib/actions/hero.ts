"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function createHeroTitle(formData: FormData) {
  const title = formData.get("title") as string;
  const count = await prisma.heroTitle.count();
  await prisma.heroTitle.create({ data: { title, sortOrder: count } });
  revalidatePath("/hero/titles");
  revalidatePortfolio();
}

export async function updateHeroTitle(id: string, formData: FormData) {
  const title = formData.get("title") as string;
  await prisma.heroTitle.update({ where: { id }, data: { title } });
  revalidatePath("/hero/titles");
  revalidatePortfolio();
}

export async function deleteHeroTitle(id: string) {
  await prisma.heroTitle.delete({ where: { id } });
  revalidatePath("/hero/titles");
  revalidatePortfolio();
}

export async function createHeroSkillBadge(formData: FormData) {
  const name = formData.get("name") as string;
  const iconKey = formData.get("iconKey") as string;
  const count = await prisma.heroSkillBadge.count();
  await prisma.heroSkillBadge.create({ data: { name, iconKey, sortOrder: count } });
  revalidatePath("/hero/skill-badges");
  revalidatePortfolio();
}

export async function updateHeroSkillBadge(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const iconKey = formData.get("iconKey") as string;
  await prisma.heroSkillBadge.update({ where: { id }, data: { name, iconKey } });
  revalidatePath("/hero/skill-badges");
  revalidatePortfolio();
}

export async function deleteHeroSkillBadge(id: string) {
  await prisma.heroSkillBadge.delete({ where: { id } });
  revalidatePath("/hero/skill-badges");
  revalidatePortfolio();
}
