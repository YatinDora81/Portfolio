"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";

export async function createContactPurpose(formData: FormData) {
  const { _max } = await prisma.contactPurpose.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.contactPurpose.create({
    data: {
      label: formData.get("label") as string,
      emoji: formData.get("emoji") as string,
      sortOrder: count,
    },
  });
  revalidatePath("/contact-purposes");
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
}

export async function deleteContactPurpose(id: string) {
  await prisma.contactPurpose.delete({ where: { id } });
  revalidatePath("/contact-purposes");
}
