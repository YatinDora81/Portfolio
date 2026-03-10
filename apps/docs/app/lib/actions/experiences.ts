"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  website: string | null;
  skillIds: string[];
  bullets: { id?: string; content: string; sortOrder: number }[];
}

export async function createExperience(data: ExperienceData) {
  const count = await prisma.experience.count();
  await prisma.experience.create({
    data: {
      company: data.company,
      position: data.position,
      location: data.location,
      startDate: data.startDate,
      endDate: data.endDate,
      isCurrent: data.isCurrent,
      website: data.website || null,
      sortOrder: count,
      skills: { connect: data.skillIds.map((id) => ({ id })) },
      bullets: {
        create: data.bullets.map((b) => ({ content: b.content, sortOrder: b.sortOrder })),
      },
    },
  });
  revalidatePath("/experiences");
  revalidatePortfolio();
}

export async function updateExperience(id: string, data: ExperienceData) {
  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id },
      data: {
        company: data.company,
        position: data.position,
        location: data.location,
        startDate: data.startDate,
        endDate: data.endDate,
        isCurrent: data.isCurrent,
        website: data.website || null,
        skills: { set: data.skillIds.map((sid) => ({ id: sid })) },
      },
    });

    const existingIds = data.bullets.filter((b) => b.id).map((b) => b.id!);
    await tx.experienceBullet.deleteMany({
      where: { experienceId: id, id: { notIn: existingIds } },
    });

    for (const bullet of data.bullets) {
      if (bullet.id) {
        await tx.experienceBullet.update({
          where: { id: bullet.id },
          data: { content: bullet.content, sortOrder: bullet.sortOrder },
        });
      } else {
        await tx.experienceBullet.create({
          data: { content: bullet.content, sortOrder: bullet.sortOrder, experienceId: id },
        });
      }
    }
  });
  revalidatePath("/experiences");
  revalidatePortfolio();
}

export async function deleteExperience(id: string) {
  await prisma.experience.delete({ where: { id } });
  revalidatePath("/experiences");
  revalidatePortfolio();
}
