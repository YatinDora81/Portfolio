"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function createContactPurpose(formData: FormData) {
  const count = await prisma.contactPurpose.count();
  await prisma.contactPurpose.create({
    data: {
      label: formData.get("label") as string,
      emoji: formData.get("emoji") as string,
      sortOrder: count,
    },
  });
  revalidatePath("/contact-purposes");
  revalidatePortfolio();
}

export async function updateContactPurpose(id: string, formData: FormData) {
  await prisma.contactPurpose.update({
    where: { id },
    data: {
      label: formData.get("label") as string,
      emoji: formData.get("emoji") as string,
    },
  });
  revalidatePath("/contact-purposes");
  revalidatePortfolio();
}

export async function deleteContactPurpose(id: string) {
  await prisma.contactPurpose.delete({ where: { id } });
  revalidatePath("/contact-purposes");
  revalidatePortfolio();
}
