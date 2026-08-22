"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveLifecycle } from "@/lib/lifecycle";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so each writer below has to prove the session itself: middleware only
 * checks that the cookie holds a valid JWT, and it never runs for a direct
 * action POST at all.
 *
 * `redirect` rather than a returned `{ ok: false }` so an expired session can
 * never look like a successful write to a caller that ignores the return value.
 */
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
  /**
   * The lifecycle, unparsed. A bare `string` and not `ContentStatus` on
   * purpose: this crosses the network as a server-action argument, so the type
   * is a hint on one side and nothing at all on the other. `resolveLifecycle`
   * is what actually decides.
   */
  status: string;
  /** "YYYY-MM-DDTHH:mm" in IST, or null. Never an instant — see lib/lifecycle.ts. */
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
      // A project's `publishedAt` is nullable, and half of "a visitor may see
      // this" is `publishedAt <= now`. PUBLISHED with a null one satisfies
      // neither half: the project would vanish from the site with nothing
      // logged and no error anywhere. Stamped on the way in instead.
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
        // Stamped only on the FIRST publish — see createProject for why a
        // PUBLISHED project needs one at all. Re-saving an already-published
        // project must not re-date it, and moving one to DRAFT or ARCHIVED
        // keeps the original date so publishing it again restores it rather
        // than inventing a new one.
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

/**
 * Rewrites every project's sortOrder from the order of `ids`. The portfolio
 * shows the first three as highlights and folds the rest, so position one is
 * the slot that actually gets read. One transaction, so a half-applied order
 * can't reach the site.
 */
export async function reorderProjects(ids: string[]) {
  await requireSession();
  await prisma.$transaction(
    ids.map((id, sortOrder) => prisma.project.update({ where: { id }, data: { sortOrder } }))
  );
  revalidatePath("/projects");
}
