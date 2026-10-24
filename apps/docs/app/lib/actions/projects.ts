"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveBuild, resolveLifecycle } from "@/lib/lifecycle";

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
  buildState: string;
  buildVersion: string | null;
  etaLabel: string | null;
  milestones: { id?: string; label: string; state: string; sortOrder: number }[];
}

type Saved = { ok: boolean; error?: string };

export async function createProject(data: ProjectData): Promise<Saved> {
  await requireSession();

  const lifecycle = resolveLifecycle(data.status, data.publishAtIst);
  if (!lifecycle.ok) return { ok: false, error: lifecycle.error };

  const build = resolveBuild(data.buildState, data.buildVersion, data.etaLabel, data.milestones);
  if (!build.ok) return { ok: false, error: build.error };

  const images = data.images.filter(Boolean);
  const { _max } = await prisma.project.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.project.create({
    data: {
      title: data.title,
      summary: data.summary,
      github: data.github || null,
      live: data.live || null,
      logoUrl: data.logoUrl || null,
      sortOrder: count,
      status: lifecycle.status,
      publishAt: lifecycle.publishAt,
      publishedAt: lifecycle.status === "PUBLISHED" ? new Date() : null,
      buildState: build.buildState,
      buildVersion: build.buildVersion,
      etaLabel: build.etaLabel,
      gallery: {
        create: images.map((externalUrl, sortOrder) => ({ externalUrl, sortOrder })),
      },
      skills: {
        create: data.skillIds.map((skillId, sortOrder) => ({ skillId, sortOrder })),
      },
      bullets: {
        create: data.bullets.map((b) => ({ content: b.content, sortOrder: b.sortOrder })),
      },
      milestones: {
        create: build.milestones.map((m) => ({
          label: m.label,
          state: m.state,
          sortOrder: m.sortOrder,
        })),
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

  const build = resolveBuild(data.buildState, data.buildVersion, data.etaLabel, data.milestones);
  if (!build.ok) return { ok: false, error: build.error };

  const images = data.images.filter(Boolean);

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
        status: lifecycle.status,
        publishAt: lifecycle.publishAt,
        buildState: build.buildState,
        buildVersion: build.buildVersion,
        etaLabel: build.etaLabel,
        ...(lifecycle.status === "PUBLISHED" && current?.publishedAt == null
          ? { publishedAt: new Date() }
          : {}),
      },
    });

    await tx.projectImage.deleteMany({ where: { projectId: id } });
    if (images.length) {
      await tx.projectImage.createMany({
        data: images.map((externalUrl, sortOrder) => ({ projectId: id, externalUrl, sortOrder })),
      });
    }

    await tx.projectSkill.deleteMany({ where: { projectId: id } });
    if (data.skillIds.length) {
      await tx.projectSkill.createMany({
        data: data.skillIds.map((skillId, sortOrder) => ({ projectId: id, skillId, sortOrder })),
      });
    }

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

    const keptMilestones = build.milestones.filter((m) => m.id).map((m) => m.id!);
    await tx.projectMilestone.deleteMany({
      where: { projectId: id, id: { notIn: keptMilestones } },
    });

    const stored = keptMilestones.length
      ? await tx.projectMilestone.findMany({
          where: { projectId: id, id: { in: keptMilestones } },
          select: { id: true, label: true, state: true, sortOrder: true, updatedAt: true },
        })
      : [];
    const before = new Map(stored.map((m) => [m.id, m]));

    for (const milestone of build.milestones) {
      const was = milestone.id ? before.get(milestone.id) : undefined;

      if (!was) {
        await tx.projectMilestone.create({
          data: {
            label: milestone.label,
            state: milestone.state,
            sortOrder: milestone.sortOrder,
            projectId: id,
          },
        });
        continue;
      }

      const said = was.label === milestone.label && was.state === milestone.state;
      if (said && was.sortOrder === milestone.sortOrder) continue;

      await tx.projectMilestone.update({
        where: { id: was.id },
        data: {
          label: milestone.label,
          state: milestone.state,
          sortOrder: milestone.sortOrder,
          ...(said ? { updatedAt: was.updatedAt } : {}),
        },
      });
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
