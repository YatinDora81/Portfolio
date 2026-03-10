"use server";

import { prisma, ScoreType } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function createAboutParagraph(formData: FormData) {
  const content = formData.get("content") as string;
  const count = await prisma.aboutParagraph.count();
  await prisma.aboutParagraph.create({ data: { content, sortOrder: count } });
  revalidatePath("/about/paragraphs");
  revalidatePortfolio();
}

export async function updateAboutParagraph(id: string, formData: FormData) {
  const content = formData.get("content") as string;
  await prisma.aboutParagraph.update({ where: { id }, data: { content } });
  revalidatePath("/about/paragraphs");
  revalidatePortfolio();
}

export async function deleteAboutParagraph(id: string) {
  await prisma.aboutParagraph.delete({ where: { id } });
  revalidatePath("/about/paragraphs");
  revalidatePortfolio();
}

export async function createEducation(formData: FormData) {
  const count = await prisma.education.count();
  await prisma.education.create({
    data: {
      institution: formData.get("institution") as string,
      location: formData.get("location") as string,
      degree: formData.get("degree") as string,
      scoreType: (formData.get("scoreType") as ScoreType) || null,
      score: (formData.get("score") as string) || null,
      scoreTotal: (formData.get("scoreTotal") as string) || null,
      startYear: formData.get("startYear") as string,
      endYear: formData.get("endYear") as string,
      sortOrder: count,
    },
  });
  revalidatePath("/about/education");
  revalidatePortfolio();
}

export async function updateEducation(id: string, formData: FormData) {
  await prisma.education.update({
    where: { id },
    data: {
      institution: formData.get("institution") as string,
      location: formData.get("location") as string,
      degree: formData.get("degree") as string,
      scoreType: (formData.get("scoreType") as ScoreType) || null,
      score: (formData.get("score") as string) || null,
      scoreTotal: (formData.get("scoreTotal") as string) || null,
      startYear: formData.get("startYear") as string,
      endYear: formData.get("endYear") as string,
    },
  });
  revalidatePath("/about/education");
  revalidatePortfolio();
}

export async function deleteEducation(id: string) {
  await prisma.education.delete({ where: { id } });
  revalidatePath("/about/education");
  revalidatePortfolio();
}
