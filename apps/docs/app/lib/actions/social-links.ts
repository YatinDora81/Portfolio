"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function createSocialLink(formData: FormData) {
  const name = formData.get("name") as string;
  const href = formData.get("href") as string;
  const iconKey = formData.get("iconKey") as string;
  const detail = (formData.get("detail") as string) || null;
  const count = await prisma.socialLink.count();
  await prisma.socialLink.create({ data: { name, href, iconKey, detail, sortOrder: count } });
  revalidatePath("/social-links");
  revalidatePath("/links");
  revalidatePortfolio();
}

export async function updateSocialLink(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const href = formData.get("href") as string;
  const iconKey = formData.get("iconKey") as string;
  const detail = (formData.get("detail") as string) || null;
  await prisma.socialLink.update({ where: { id }, data: { name, href, iconKey, detail } });
  revalidatePath("/social-links");
  revalidatePath("/links");
  revalidatePortfolio();
}

export async function deleteSocialLink(id: string) {
  await prisma.socialLink.delete({ where: { id } });
  revalidatePath("/social-links");
  revalidatePath("/links");
  revalidatePortfolio();
}
