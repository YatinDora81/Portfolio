"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";

export async function createQuote(formData: FormData) {
  await prisma.quote.create({
    data: {
      quote: formData.get("quote") as string,
      author: formData.get("author") as string,
    },
  });
  revalidatePath("/quotes");
}

export async function updateQuote(id: string, formData: FormData) {
  await prisma.quote.update({
    where: { id },
    data: {
      quote: formData.get("quote") as string,
      author: formData.get("author") as string,
    },
  });
  revalidatePath("/quotes");
}

export async function deleteQuote(id: string) {
  await prisma.quote.delete({ where: { id } });
  revalidatePath("/quotes");
}
