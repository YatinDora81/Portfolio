"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function updateResumeUrl(url: string) {
  await prisma.siteConfig.upsert({
    where: { key: "resumeUrl" },
    create: { key: "resumeUrl", value: url },
    update: { value: url },
  });
  revalidatePath("/links");
  revalidatePath("/site-config");
  revalidatePortfolio();
}
