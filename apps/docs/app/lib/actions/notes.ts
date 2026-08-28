"use server";

import { prisma, Prisma } from "db";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  NoteError,
  createIn,
  duplicateIn,
  importIn,
  moveIn,
  normaliseTags,
  renameIn,
  reorderIn,
  restoreIn,
  trashIn,
} from "@/lib/notes/core";
import { MAX_JSON_BYTES, parseImport, type FolderMode, type ImportMode } from "@/lib/notes/import";
import { VAULT_TAG } from "@/lib/notes/vault";

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

export type NodeResult = { ok: true; id: string; path: string } | { ok: false; error: string };
export type VoidResult = { ok: true } | { ok: false; error: string };

const touched = () => {
  updateTag(VAULT_TAG);
  revalidatePath("/notes", "layout");
};

const rated = () => revalidateTag(VAULT_TAG, "max");

async function write<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeout?: number; maxWait?: number; invalidate?: () => void },
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const { invalidate = touched, ...tx } = opts ?? {};
  try {
    const value = await prisma.$transaction(fn, tx);
    invalidate();
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

export async function importVault(
  destParentId: string | null,
  json: string,
  mode: ImportMode = "into",
  folders: FolderMode = "create",
): Promise<NodeResult> {
  await requireSession();

  if (destParentId !== null && typeof destParentId !== "string") {
    return { ok: false, error: "Pick a folder to import into" };
  }
  if (typeof json !== "string") return { ok: false, error: "Paste the JSON text" };
  if (mode !== "into" && mode !== "restore") return { ok: false, error: "Unknown import mode" };
  if (folders !== "merge" && folders !== "create") return { ok: false, error: "Unknown folder mode" };
  // bytes, not characters
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    return { ok: false, error: "That file is too large to import" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "That isn't valid JSON" };
  }

  const parsed = parseImport(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (mode === "restore" && parsed.shape !== "vault") {
    return { ok: false, error: "Restore needs a vault export, not a nested outline." };
  }

  const r = await write((tx) => importIn(tx, destParentId, parsed.nodes, mode, folders), {
    timeout: 120_000,
    maxWait: 10_000,
  });
  if (!r.ok) return { ok: false, error: r.error };

  const first = r.value.rootIds[0];
  const node = first
    ? await prisma.noteNode.findUnique({ where: { id: first }, select: { id: true, path: true } })
    : null;
  return node ? { ok: true, id: node.id, path: node.path } : { ok: false, error: "Imported, but couldn't find the result" };
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
    return tx.noteNode.findUniqueOrThrow({ where: { id: nodeId }, select: { id: true, path: true } });
  });
  return r.ok ? { ok: true, id: r.value.id, path: r.value.path } : { ok: false, error: r.error };
}

export async function setConfidence(nodeId: string, value: number): Promise<VoidResult> {
  await requireSession();
  const v = Math.max(0, Math.min(4, Math.round(value)));
  return voided(
    await write(
      (tx) =>
        tx.noteAnswer
          .update({ where: { nodeId }, data: { confidence: v, lastRevisedAt: new Date() } })
          .then(() => undefined),
      { invalidate: rated },
    ),
  );
}
