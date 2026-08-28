"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

export async function updateResumeUrl(url: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };

  await prisma.siteConfig.upsert({
    where: { key: "resumeUrl" },
    create: { key: "resumeUrl", value: url },
    update: { value: url },
  });
  // /hero, not /links: the form moved there
  revalidatePath("/hero");
  return { ok: true };
}
