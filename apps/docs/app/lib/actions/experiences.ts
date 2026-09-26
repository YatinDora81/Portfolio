"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { monthInputToUtc } from "@/lib/lifecycle";

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startedOn: string;
  endedOn: string | null;
  website: string | null;
  logoUrl: string | null;
  visibleBullets: number;
  skillIds: string[];
  bullets: { id?: string; content: string; sortOrder: number }[];
}

function readPeriod(data: ExperienceData): { startedOn: Date; endedOn: Date | null } {
  const startedOn = monthInputToUtc(data.startedOn);
  if (!startedOn) throw new Error("The start month has to be a month, like 2025-07.");

  const raw = data.endedOn?.trim();
  if (!raw) return { startedOn, endedOn: null };

  const endedOn = monthInputToUtc(raw);
  if (!endedOn) throw new Error("The end month has to be a month, like 2025-07, or be left empty.");
  if (endedOn < startedOn) throw new Error("The end month cannot come before the start month.");

  return { startedOn, endedOn };
}

export async function createExperience(data: ExperienceData) {
  await requireSession();
  const period = readPeriod(data);
  const { _max } = await prisma.experience.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.experience.create({
    data: {
      company: data.company,
      position: data.position,
      location: data.location,
      startedOn: period.startedOn,
      endedOn: period.endedOn,
      website: data.website || null,
      logoUrl: data.logoUrl || null,
      visibleBullets: data.visibleBullets,
      sortOrder: count,
      skills: {
        create: data.skillIds.map((skillId, sortOrder) => ({ skillId, sortOrder })),
      },
      bullets: {
        create: data.bullets.map((b) => ({ content: b.content, sortOrder: b.sortOrder })),
      },
    },
  });
  revalidatePath("/experiences");
}

export async function updateExperience(id: string, data: ExperienceData) {
  await requireSession();
  const period = readPeriod(data);
  await prisma.$transaction(async (tx) => {
    await tx.experience.update({
      where: { id },
      data: {
        company: data.company,
        position: data.position,
        location: data.location,
        startedOn: period.startedOn,
        endedOn: period.endedOn,
        website: data.website || null,
        logoUrl: data.logoUrl || null,
        visibleBullets: data.visibleBullets,
      },
    });

    await tx.experienceSkill.deleteMany({ where: { experienceId: id } });
    if (data.skillIds.length) {
      await tx.experienceSkill.createMany({
        data: data.skillIds.map((skillId, sortOrder) => ({ experienceId: id, skillId, sortOrder })),
      });
    }

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
}

export async function deleteExperience(id: string) {
  await requireSession();
  await prisma.experience.delete({ where: { id } });
  revalidatePath("/experiences");
}
