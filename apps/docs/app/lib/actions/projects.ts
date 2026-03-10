"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

interface ProjectData {
  title: string;
  summary: string;
  github: string | null;
  live: string | null;
  images: string[];
  skillIds: string[];
  bullets: { id?: string; content: string; sortOrder: number }[];
}

export async function createProject(data: ProjectData) {
  const count = await prisma.project.count();
  await prisma.project.create({
    data: {
      title: data.title,
      summary: data.summary,
      github: data.github || null,
      live: data.live || null,
      images: data.images.filter(Boolean),
      sortOrder: count,
      skills: { connect: data.skillIds.map((id) => ({ id })) },
      bullets: {
        create: data.bullets.map((b) => ({ content: b.content, sortOrder: b.sortOrder })),
      },
    },
  });
  revalidatePath("/projects");
  revalidatePortfolio();
}

export async function updateProject(id: string, data: ProjectData) {
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id },
      data: {
        title: data.title,
        summary: data.summary,
        github: data.github || null,
        live: data.live || null,
        images: data.images.filter(Boolean),
        skills: { set: data.skillIds.map((sid) => ({ id: sid })) },
      },
    });

    const existingIds = data.bullets.filter((b) => b.id).map((b) => b.id!);
    await tx.projectBullet.deleteMany({
      where: { projectId: id, id: { notIn: existingIds } },
    });

    for (const bullet of data.bullets) {
      if (bullet.id) {
        await tx.projectBullet.update({
          where: { id: bullet.id },
          data: { content: bullet.content, sortOrder: bullet.sortOrder },
        });
      } else {
        await tx.projectBullet.create({
          data: { content: bullet.content, sortOrder: bullet.sortOrder, projectId: id },
        });
      }
    }
  });
  revalidatePath("/projects");
  revalidatePortfolio();
}

export async function deleteProject(id: string) {
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
  revalidatePortfolio();
}
