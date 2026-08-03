"use server";

import { prisma, Prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  NoteError,
  createIn,
  duplicateIn,
  moveIn,
  normaliseTags,
  renameIn,
  reorderIn,
  restoreIn,
  trashIn,
} from "@/lib/notes/core";

/**
 * The private notes vault's write surface.
 *
 * Three facts shape every export below.
 *
 * 1. **`"use server"` exports are public POST endpoints.** They are addressable
 *    by action id and middleware never runs for a direct action POST, so each
 *    one proves the session itself rather than trusting the page that rendered
 *    the button. Same reasoning as blogs.ts.
 * 2. **Nothing here publishes.** The vault is deliberately absent from
 *    staging.ts's `Entity` union, `publishSite()` is never called, and no path
 *    in apps/web is revalidated. `revalidatePath("/notes", "layout")` refreshes
 *    the admin's own render cache and nothing else — `"layout"` and not
 *    `"page"`, because the tree is rendered by the layout and a page-scoped call
 *    leaves every sidebar row stale.
 * 3. **The algebra is not here.** It is in `lib/notes/core.ts`, as functions of
 *    a transaction client, so the integration test can drive the code that
 *    actually ships instead of a copy of it. What is left in this file is the
 *    session check, the transaction boundary, and turning a thrown refusal back
 *    into something a component can render.
 */
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

export type NodeResult = { ok: true; id: string; path: string } | { ok: false; error: string };
export type VoidResult = { ok: true } | { ok: false; error: string };

const touched = () => revalidatePath("/notes", "layout");

/** Runs `fn` in one transaction, and turns the two failure modes a component
 *  needs to tell apart — a refusal it should show, and a crash it should not
 *  paraphrase — into the same shape. */
async function write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await prisma.$transaction(fn);
    touched();
    return { ok: true, value };
  } catch (e) {
    if (e instanceof NoteError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return { ok: false, error: "That note no longer exists" };
      if (e.code === "P2002") return { ok: false, error: "A note already uses that name here" };
    }
    console.error("[notes]", e);
    return { ok: false, error: "Something went wrong" };
  }
}

const voided = (r: { ok: true } | { ok: false; error: string }): VoidResult =>
  r.ok ? { ok: true } : { ok: false, error: r.error };

export async function createNode(
  parentId: string | null,
  kind: "FOLDER" | "QUESTION",
  title: string,
): Promise<NodeResult> {
  await requireSession();
  const r = await write((tx) => createIn(tx, parentId, kind, title));
  return r.ok ? { ok: true, id: r.value.id, path: r.value.path } : { ok: false, error: r.error };
}

export async function renameNode(id: string, title: string): Promise<VoidResult> {
  await requireSession();
  return voided(await write((tx) => renameIn(tx, id, title)));
}

export async function moveNode(id: string, newParentId: string | null, index?: number): Promise<VoidResult> {
  await requireSession();
  return voided(await write((tx) => moveIn(tx, id, newParentId, index)));
}

export async function reorderSiblings(parentId: string | null, orderedIds: string[]): Promise<VoidResult> {
  await requireSession();
  if (orderedIds.length > 500) return { ok: false, error: "Too many rows" };
  return voided(await write((tx) => reorderIn(tx, parentId, orderedIds)));
}

/** Nudge one row past its neighbour — the tree's ⌥↑ / ⌥↓ and the context menu. */
export async function nudgeNode(id: string, dir: -1 | 1): Promise<VoidResult> {
  await requireSession();
  return voided(
    await write(async (tx) => {
      const n = await tx.noteNode.findUniqueOrThrow({ where: { id }, select: { parentId: true } });
      const sibs = await tx.noteNode.findMany({
        where: { parentId: n.parentId, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const ids = sibs.map((s) => s.id);
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      await reorderIn(tx, n.parentId, ids);
    }),
  );
}

export async function trashNode(id: string): Promise<VoidResult> {
  await requireSession();
  return voided(await write((tx) => trashIn(tx, id)));
}

export async function restoreNode(id: string): Promise<VoidResult> {
  await requireSession();
  return voided(await write((tx) => restoreIn(tx, id)));
}

/**
 * Permanent. The FK cascade takes descendants and their answers with it.
 *
 * The guard is not decoration. This is the only irreversible gesture in the
 * feature, and it is reachable as a bare POST by action id — so it refuses to
 * act on anything that is not already in the trash. Without that, one request
 * naming a live root folder erases it and everything beneath it, with no undo
 * and no trace, and the UI that would have asked for a confirmation was never
 * involved. `emptyTrash` below carries the same predicate for the same reason.
 */
export async function purgeNode(id: string): Promise<VoidResult> {
  await requireSession();
  return voided(
    await write(async (tx) => {
      const n = await tx.noteNode.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } });
      if (!n.deletedAt) throw new NoteError("Only a note already in the trash can be deleted for good");
      await tx.noteNode.delete({ where: { id } });
    }),
  );
}

export async function emptyTrash(): Promise<VoidResult> {
  await requireSession();
  return voided(
    await write((tx) =>
      tx.noteNode.deleteMany({ where: { trashRoot: true, NOT: { deletedAt: null } } }).then(() => undefined),
    ),
  );
}

export async function duplicateNode(id: string): Promise<NodeResult> {
  await requireSession();
  const r = await write((tx) => duplicateIn(tx, id));
  return r.ok ? { ok: true, id: r.value.id, path: r.value.path } : { ok: false, error: r.error };
}

export async function saveAnswer(
  nodeId: string,
  data: { title?: string; body?: string; tags?: string[] },
): Promise<NodeResult> {
  await requireSession();
  const r = await write(async (tx) => {
    if (data.title !== undefined) await renameIn(tx, nodeId, data.title);
    if (data.body !== undefined || data.tags !== undefined) {
      await tx.noteAnswer.update({
        where: { nodeId },
        data: {
          ...(data.body !== undefined ? { body: data.body } : {}),
          ...(data.tags !== undefined ? { tags: normaliseTags(data.tags) } : {}),
        },
      });
    }
    // The new path is returned because renaming rewrites it, and the browser is
    // sitting on the old one: without this the editor saves successfully and
    // then navigates itself to a 404.
    return tx.noteNode.findUniqueOrThrow({ where: { id: nodeId }, select: { id: true, path: true } });
  });
  return r.ok ? { ok: true, id: r.value.id, path: r.value.path } : { ok: false, error: r.error };
}

export async function setConfidence(nodeId: string, value: number): Promise<VoidResult> {
  await requireSession();
  const v = Math.max(0, Math.min(4, Math.round(value)));
  return voided(
    await write((tx) =>
      tx.noteAnswer
        .update({ where: { nodeId }, data: { confidence: v, lastRevisedAt: new Date() } })
        .then(() => undefined),
    ),
  );
}
