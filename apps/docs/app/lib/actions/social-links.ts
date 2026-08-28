"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

export async function createSocialLink(formData: FormData) {
  await requireSession();
  const name = formData.get("name") as string;
  const href = formData.get("href") as string;
  const iconKey = formData.get("iconKey") as string;
  const detail = (formData.get("detail") as string) || null;
  const { _max } = await prisma.socialLink.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  // a null version means the link shows in every hero version
  await prisma.socialLink.create({ data: { name, href, iconKey, detail, sortOrder: count } });
  revalidatePath("/hero");
}

export async function updateSocialLink(id: string, formData: FormData) {
  await requireSession();
  const name = formData.get("name") as string;
  const href = formData.get("href") as string;
  const iconKey = formData.get("iconKey") as string;
  const detail = (formData.get("detail") as string) || null;
  await prisma.socialLink.update({ where: { id }, data: { name, href, iconKey, detail } });
  revalidatePath("/hero");
}

export async function deleteSocialLink(id: string) {
  await requireSession();
  await prisma.socialLink.delete({ where: { id } });
  revalidatePath("/hero");
}
