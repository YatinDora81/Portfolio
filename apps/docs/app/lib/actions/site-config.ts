"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function updateSiteConfig(entries: { key: string; value: string }[]) {
  await prisma.$transaction(
    entries.map(({ key, value }) =>
      prisma.siteConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
    )
  );
  revalidatePath("/site-config");
  revalidatePortfolio();
}
