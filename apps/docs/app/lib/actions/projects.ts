"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";

interface ProjectData {
  title: string;
  summary: string;
  github: string | null;
  live: string | null;
  logoUrl: string | null;
  images: string[];
  skillIds: string[];
  bullets: { id?: string; content: string; sortOrder: number }[];
}

export async function createProject(data: ProjectData) {
  const { _max } = await prisma.project.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.project.create({
    data: {
      title: data.title,
      summary: data.summary,
      github: data.github || null,
      live: data.live || null,
      logoUrl: data.logoUrl || null,
      images: data.images.filter(Boolean),
      sortOrder: count,
      skills: { connect: data.skillIds.map((id) => ({ id })) },
      bullets: {
        create: data.bullets.map((b) => ({ content: b.content, sortOrder: b.sortOrder })),
      },
    },
  });
  revalidatePath("/projects");
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
        logoUrl: data.logoUrl || null,
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
}

export async function deleteProject(id: string) {
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
}

/**
 * Rewrites every project's sortOrder from the order of `ids`. The portfolio
 * shows the first three as highlights and folds the rest, so position one is
 * the slot that actually gets read. One transaction, so a half-applied order
 * can't reach the site.
 */
export async function reorderProjects(ids: string[]) {
  await prisma.$transaction(
    ids.map((id, sortOrder) => prisma.project.update({ where: { id }, data: { sortOrder } }))
  );
  revalidatePath("/projects");
}
