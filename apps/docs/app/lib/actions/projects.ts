"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveLifecycle } from "@/lib/lifecycle";

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

interface ProjectData {
  title: string;
  summary: string;
  github: string | null;
  live: string | null;
  logoUrl: string | null;
  images: string[];
  skillIds: string[];
  bullets: { id?: string; content: string; sortOrder: number }[];
  status: string;
  publishAtIst: string | null;
}

type Saved = { ok: boolean; error?: string };

export async function createProject(data: ProjectData): Promise<Saved> {
  await requireSession();

  const lifecycle = resolveLifecycle(data.status, data.publishAtIst);
  if (!lifecycle.ok) return { ok: false, error: lifecycle.error };

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
      status: lifecycle.status,
      publishAt: lifecycle.publishAt,
      publishedAt: lifecycle.status === "PUBLISHED" ? new Date() : null,
      skills: { connect: data.skillIds.map((id) => ({ id })) },
      bullets: {
        create: data.bullets.map((b) => ({ content: b.content, sortOrder: b.sortOrder })),
      },
    },
  });
  revalidatePath("/projects");
  return { ok: true };
}

export async function updateProject(id: string, data: ProjectData): Promise<Saved> {
  await requireSession();

  const lifecycle = resolveLifecycle(data.status, data.publishAtIst);
  if (!lifecycle.ok) return { ok: false, error: lifecycle.error };

  await prisma.$transaction(async (tx) => {
    const current = await tx.project.findUnique({ where: { id }, select: { publishedAt: true } });

    await tx.project.update({
      where: { id },
      data: {
        title: data.title,
        summary: data.summary,
        github: data.github || null,
        live: data.live || null,
        logoUrl: data.logoUrl || null,
        images: data.images.filter(Boolean),
        status: lifecycle.status,
        publishAt: lifecycle.publishAt,
        // first publish only, re-saving must not re-date it
        ...(lifecycle.status === "PUBLISHED" && current?.publishedAt == null
          ? { publishedAt: new Date() }
          : {}),
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
  return { ok: true };
}

export async function deleteProject(id: string) {
  await requireSession();
  await prisma.project.delete({ where: { id } });
  revalidatePath("/projects");
}

export async function reorderProjects(ids: string[]) {
  await requireSession();
  await prisma.$transaction(
    ids.map((id, sortOrder) => prisma.project.update({ where: { id }, data: { sortOrder } }))
  );
  revalidatePath("/projects");
}
