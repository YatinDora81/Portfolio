"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";

export async function createHeroTitle(formData: FormData) {
  const title = formData.get("title") as string;
  const { _max } = await prisma.heroTitle.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.heroTitle.create({ data: { title, sortOrder: count } });
  revalidatePath("/hero/titles");
}

export async function updateHeroTitle(id: string, formData: FormData) {
  const title = formData.get("title") as string;
  await prisma.heroTitle.update({ where: { id }, data: { title } });
  revalidatePath("/hero/titles");
}

export async function deleteHeroTitle(id: string) {
  await prisma.heroTitle.delete({ where: { id } });
  revalidatePath("/hero/titles");
}

export async function createHeroSkillBadge(formData: FormData) {
  const name = formData.get("name") as string;
  const iconKey = formData.get("iconKey") as string;
  const { _max } = await prisma.heroSkillBadge.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.heroSkillBadge.create({ data: { name, iconKey, sortOrder: count } });
  revalidatePath("/hero/skill-badges");
}

export async function updateHeroSkillBadge(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const iconKey = formData.get("iconKey") as string;
  await prisma.heroSkillBadge.update({ where: { id }, data: { name, iconKey } });
  revalidatePath("/hero/skill-badges");
}

export async function deleteHeroSkillBadge(id: string) {
  await prisma.heroSkillBadge.delete({ where: { id } });
  revalidatePath("/hero/skill-badges");
}

/**
 * Rewrites every badge's sortOrder from the order of `ids`. The hero sentence
 * reads them in that order ("React, Next.js and TypeScript"), so the last two
 * positions are the ones that get the "and" — worth reordering deliberately.
 * One transaction so a half-applied order can never reach the site.
 */
export async function reorderHeroSkillBadges(ids: string[]) {
  await prisma.$transaction(
    ids.map((id, sortOrder) =>
      prisma.heroSkillBadge.update({ where: { id }, data: { sortOrder } })
    )
  );
  revalidatePath("/hero/skill-badges");
}
