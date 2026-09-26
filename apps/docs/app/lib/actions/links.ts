"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

export async function updateResumeUrl(url: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };

  await prisma.siteSettings.update({ where: { id: 1 }, data: { resumeUrl: url } });
  revalidatePath("/hero");
  return { ok: true };
}
