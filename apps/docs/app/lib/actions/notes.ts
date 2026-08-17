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

/**
 * Two invalidations, because they throw away different things and the section
 * needs both.
 *
 * `revalidatePath("/notes", "layout")` drops the *render* — `"layout"` and not
 * `"page"`, because the tree is rendered by the layout and a page-scoped call
 * leaves every sidebar row stale. That matters for /notes/search, /notes/trash
 * and /notes/revise, which still query Postgres directly.
 *
 * `updateTag(VAULT_TAG)` drops the same data by name rather than sideways, and
 * that is why it stays: it is the route-independent handle, it goes on working
 * the day `loadVault()` is called from somewhere with different implicit tags,
 * and it is the line a reader can follow back to vault.ts.
 *
 * Both also set `pathWasRevalidated`, which is the load-bearing half. A server
 * action posts without an `rsc` header, so the server has no router state to
 * filter against and renders the whole tree from the root — this layout, this
 * vault, in the action's own response. That response is the ONLY thing that
 * refreshes the vault the browser is holding: a shallow navigation fetches
 * nothing, and a real one reuses the shared layout. Without the flag the response
 * carries no flight data at all and the router keeps the state it had, so a
 * rename commits to Postgres and the sidebar goes on showing the old title until
 * a reload.
 *
 * That also means `touched()` is only legal inside a server action, which is the
 * only place it is called from.
 *
 * Every mutation in this file goes through `write()`, which calls this. That is
 * the invariant keeping the cache honest; a write that skips it serves the user
 * their own edit, missing.
 */
const touched = () => {
  updateTag(VAULT_TAG);
  revalidatePath("/notes", "layout");
};

/**
 * A rating, and deliberately not the invalidation above.
 *
 * `touched()` makes an action carry a whole fresh render home — a root render, an
 * uncached vault read and ~110 KB gzipped down the wire. That is right for a
 * rename, which has to reach the sidebar, the breadcrumb and the folder overview
 * at once. It is wrong for a rating: the revise deck fires one per card without
 * waiting, so a sixty-card sitting would pay all of that sixty times and leave
 * /notes/revise slower than it was before any of this.
 *
 * The profile'd form marks the entry stale without dragging a render along, and
 * deliberately does not set `pathWasRevalidated` — which means, and this is the
 * part worth writing down, the browser's copy of the vault does not update at
 * all. Not on the next navigation either: a shallow move fetches nothing and a
 * real one reuses the shared layout. So the client owns the correction instead,
 * in the ratings overlay in vault-provider.tsx. Postgres is right immediately,
 * the cached payload is right at the next structural write, and the screen is
 * right in the frame the user clicked.
 */
const rated = () => revalidateTag(VAULT_TAG, "max");


/** Runs `fn` in one transaction, and turns the two failure modes a component
 *  needs to tell apart — a refusal it should show, and a crash it should not
 *  paraphrase — into the same shape.
 *
 *  `timeout`/`maxWait` exist for exactly one caller. Prisma's 5-second
 *  interactive transaction budget is right for every write here that touches a
 *  handful of rows, and wrong for an import that may insert thousands; raising
 *  it globally would let an ordinary write hold a connection for two minutes
 *  before failing. `invalidate` exists for exactly one other — see `rated()`.
 */
async function write<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeout?: number; maxWait?: number; invalidate?: () => void },
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  // Split rather than forwarded whole: `invalidate` is this file's own option and
  // Prisma is handed only the two it knows about.
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

/**
 * Paste a file back in. The inverse of /notes/export, and the only write in this
 * file that can create more than one row.
 *
 * Everything before `write()` is refusal, in cost order: the session, then the
 * cheap type guards, then the size cap BEFORE `JSON.parse` — parsing is the
 * expensive step and a size check after it has already lost the argument — then
 * the shape. `parseImport` is the same function the dialog runs on every
 * keystroke to draw its preview, so what the user was shown and what the
 * transaction writes cannot disagree.
 *
 * Nothing here publishes and nothing is audited, which is deliberate and matches
 * every other note write: the vault is absent from staging.ts's `Entity` union,
 * and an import is undone by trashing the roots it grafted.
 */
export async function importVault(
  destParentId: string | null,
  json: string,
  mode: ImportMode = "into",
  /** Defaults to the behaviour this action always had, so a caller that predates
   *  the choice keeps getting it. The dialog asks and passes an answer. */
  folders: FolderMode = "create",
): Promise<NodeResult> {
  await requireSession();

  if (destParentId !== null && typeof destParentId !== "string") {
    return { ok: false, error: "Pick a folder to import into" };
  }
  if (typeof json !== "string") return { ok: false, error: "Paste the JSON text" };
  if (mode !== "into" && mode !== "restore") return { ok: false, error: "Unknown import mode" };
  if (folders !== "merge" && folders !== "create") return { ok: false, error: "Unknown folder mode" };
  // Bytes, not characters. A cap read off `.length` is three times looser than
  // it looks the moment the payload is not ASCII.
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
  // A nested outline has no ids, so there is nothing to restore *to*. Offering
  // the mode for it would be a button that always fails.
  if (mode === "restore" && parsed.shape !== "vault") {
    return { ok: false, error: "Restore needs a vault export, not a nested outline." };
  }

  const r = await write((tx) => importIn(tx, destParentId, parsed.nodes, mode, folders), {
    timeout: 120_000,
    maxWait: 10_000,
  });
  if (!r.ok) return { ok: false, error: r.error };

  // The first grafted root is where the browser is sent, and its path is read
  // after the commit because rebuildSubtree wrote it during the transaction.
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
    await write(
      (tx) =>
        tx.noteAnswer
          .update({ where: { nodeId }, data: { confidence: v, lastRevisedAt: new Date() } })
          .then(() => undefined),
      { invalidate: rated },
    ),
  );
}
