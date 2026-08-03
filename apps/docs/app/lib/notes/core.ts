import { Prisma } from "db";
import { slugify, uniqueSlug, moveError, tombstone, untomb } from "./paths";

/**
 * Every write the notes vault makes, as a function of a transaction client.
 *
 * It is split from `lib/actions/notes.ts` for one reason: the actions there are
 * `"use server"` exports, and a `"use server"` export cannot be called outside a
 * Next request — `revalidatePath` and `redirect` both reach for a request store
 * that a test process does not have. Putting the algebra here means the
 * integration test drives the code that actually ships, inside a transaction it
 * rolls back, instead of a re-implementation that can drift from it.
 *
 * The invariant every function below is written to hold: `parentId` is the
 * structure and `path` is a denormalised index over it, and the two may never be
 * observed disagreeing. Any write that changes a parent or a slug rebuilds the
 * subtree's paths before the transaction it runs in commits.
 */

export type Tx = Prisma.TransactionClient;

/** A refusal the user is meant to read, as opposed to a crash. Thrown rather
 *  than returned so the transaction rolls back and the message travel together. */
export class NoteError extends Error {}

/** /notes/search, /notes/revise, /notes/trash and /notes/export are real routes
 *  and they shadow the catch-all that resolves a note by path. A root folder
 *  that slugged to one of them would be a page nobody could open, so the four
 *  are treated as taken names and the user gets "search-2" instead. */
export const RESERVED_ROOT_SLUGS = ["search", "revise", "trash", "export"];

const SHAPE = {
  id: true,
  parentId: true,
  slug: true,
  path: true,
  depth: true,
  trashRoot: true,
} as const;

type Shape = {
  id: string;
  parentId: string | null;
  slug: string;
  path: string;
  depth: number;
  trashRoot: boolean;
};

/** A node inside the trash addresses its children by its live path. The
 *  tombstone is a name reservation, not a level of the tree. */
const liveOf = (p: string) => untomb(p);

/**
 * Recompute `path` and `depth` for a node and everything beneath it, then write
 * the lot in one statement.
 *
 * The tempting implementation is the prefix rewrite that the `path` column
 * exists to enable — `SET path = $new || substring(path from $len+1) WHERE path
 * LIKE $old || '/%'`. It is one statement, and it is wrong in two cases this app
 * reaches in normal use:
 *
 *   - A subtree can contain an already-trashed node, whose path was moved under
 *     its own `~trash/<id>` tombstone. That path no longer carries its parent's
 *     prefix, so a LIKE rewrite skips it and everything below it, and they go on
 *     pointing at an ancestry that no longer exists.
 *   - Descendant depth can only be shifted by a delta, and deriving the old
 *     depth by counting segments in the old path — which is what makes the
 *     one-statement version self-contained — breaks the moment that string is a
 *     tombstone, because `~trash/<uuid>` contributes two segments that were
 *     never levels of the tree.
 *
 * So the walk happens in memory from `parentId`, which is the source of truth,
 * and the result is applied with a single `unnest` join: one round trip, and
 * correct for a subtree holding tombstones. The table is a personal vault of a
 * few hundred rows — the same scale argument that makes the sidebar load flat.
 */
export async function rebuildSubtree(tx: Tx, rootId: string): Promise<void> {
  const all = (await tx.noteNode.findMany({ select: SHAPE })) as Shape[];
  const byId = new Map(all.map((n) => [n.id, n]));
  const childrenOf = new Map<string, Shape[]>();
  for (const n of all) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

  const root = byId.get(rootId);
  if (!root) return;
  const parent = root.parentId ? byId.get(root.parentId) : null;

  const ids: string[] = [];
  const paths: string[] = [];
  const depths: number[] = [];

  // The tombstone covers the whole trashed subtree, not just the row somebody
  // clicked Trash on. Freeing only the root's name leaves every path beneath it
  // occupied, so trashing /dsa/dp and rebuilding it collides on /dsa/dp/inner
  // instead of on /dsa/dp — the same unique violation, one level deeper and much
  // harder to recognise.
  //
  // `tombId` is the NEAREST enclosing trashRoot. A row that was trashed on its
  // own and then swallowed by a parent being trashed does not get a second
  // tombstone stacked on the first; it is absorbed into its ancestor's, and
  // recovers its own the moment that ancestor is restored, because this walk
  // recomputes from scratch every time rather than patching what is there.
  const walk = (n: Shape, basePath: string, depth: number, tombId: string | null) => {
    const live = `${basePath}/${n.slug}`;
    const tomb = tombId ?? (n.trashRoot ? n.id : null);
    const path = tomb ? tombstone(tomb, live) : live;
    if (path !== n.path || depth !== n.depth) {
      ids.push(n.id);
      paths.push(path);
      depths.push(depth);
    }
    for (const c of childrenOf.get(n.id) ?? []) walk(c, live, depth + 1, tomb);
  };
  walk(root, parent ? liveOf(parent.path) : "", parent ? parent.depth + 1 : 0, null);

  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE "NoteNode" AS n
       SET "path" = v.path, "depth" = v.depth
      FROM (SELECT * FROM unnest(${ids}::text[], ${paths}::text[], ${depths}::int[]) AS t(id, path, depth)) AS v
     WHERE n.id = v.id`;
}

/** Structure comes from `parentId`, never from `path` — including here, where a
 *  tombstoned descendant's path would not carry its ancestor's prefix. */
export async function subtreeIds(tx: Tx, rootId: string): Promise<string[]> {
  const all = await tx.noteNode.findMany({ select: { id: true, parentId: true } });
  const childrenOf = new Map<string, string[]>();
  for (const n of all) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }
  const out = [rootId];
  for (let i = 0; i < out.length; i++) out.push(...(childrenOf.get(out[i]!) ?? []));
  return out;
}

/**
 * The rows a restore should bring back: the subtree, stopping at anything that
 * was trashed on its own account.
 *
 * Trashing a question and later trashing the folder around it are two separate
 * decisions, and undoing the second must not silently undo the first — otherwise
 * restoring a folder resurrects everything you ever threw away inside it, which
 * is the opposite of what "restore" means anywhere else.
 */
export async function restorableIds(tx: Tx, rootId: string): Promise<string[]> {
  const all = await tx.noteNode.findMany({ select: { id: true, parentId: true, trashRoot: true } });
  const childrenOf = new Map<string, { id: string; trashRoot: boolean }[]>();
  for (const n of all) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const c of childrenOf.get(out[i]!) ?? []) if (!c.trashRoot) out.push(c.id);
  }
  return out;
}

export async function liveSiblingSlugs(tx: Tx, parentId: string | null, exceptId?: string) {
  const rows = await tx.noteNode.findMany({
    where: { parentId, deletedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { slug: true },
  });
  const taken = rows.map((r) => r.slug);
  return parentId === null ? [...taken, ...RESERVED_ROOT_SLUGS] : taken;
}

export async function reindex(tx: Tx, parentId: string | null) {
  const sibs = await tx.noteNode.findMany({
    where: { parentId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (const [i, s] of sibs.entries()) {
    if (i !== undefined) await tx.noteNode.update({ where: { id: s.id }, data: { sortOrder: i } });
  }
}

const clean = (title: string) => {
  const t = title.trim();
  if (!t) throw new NoteError("Title required");
  if (t.length > 300) throw new NoteError("Title is too long");
  return t;
};

/** `path` is NOT NULL and UNIQUE, and its real value needs the parent's path, so
 *  a row is born holding a placeholder that cannot collide with a real path or
 *  with another create racing it. rebuildSubtree replaces it before commit. */
const placeholder = () => `~new/${crypto.randomUUID()}`;

export async function createIn(
  tx: Tx,
  parentId: string | null,
  kind: "FOLDER" | "QUESTION",
  title: string,
): Promise<{ id: string; path: string }> {
  const t = clean(title);
  if (parentId) {
    const p = await tx.noteNode.findUnique({ where: { id: parentId }, select: { kind: true, deletedAt: true } });
    if (!p) throw new NoteError("That folder no longer exists");
    if (p.kind !== "FOLDER") throw new NoteError("Only folders can hold children");
    if (p.deletedAt) throw new NoteError("That folder is in the trash");
  }
  const slug = uniqueSlug(slugify(t), await liveSiblingSlugs(tx, parentId));
  const sortOrder = await tx.noteNode.count({ where: { parentId, deletedAt: null } });
  const n = await tx.noteNode.create({
    data: { parentId, kind, title: t, slug, path: placeholder(), sortOrder },
    select: { id: true },
  });
  if (kind === "QUESTION") await tx.noteAnswer.create({ data: { nodeId: n.id } });
  await rebuildSubtree(tx, n.id);
  return tx.noteNode.findUniqueOrThrow({ where: { id: n.id }, select: { id: true, path: true } });
}

export async function renameIn(tx: Tx, id: string, title: string): Promise<void> {
  const t = clean(title);
  const n = await tx.noteNode.findUniqueOrThrow({ where: { id }, select: { parentId: true, title: true } });
  if (n.title === t) return;
  const slug = uniqueSlug(slugify(t), await liveSiblingSlugs(tx, n.parentId, id));
  await tx.noteNode.update({ where: { id }, data: { title: t, slug } });
  await rebuildSubtree(tx, id);
}

export async function moveIn(tx: Tx, id: string, newParentId: string | null, index?: number): Promise<void> {
  const node = await tx.noteNode.findUniqueOrThrow({
    where: { id },
    select: { id: true, path: true, parentId: true, title: true },
  });
  const target = newParentId
    ? await tx.noteNode.findUnique({
        where: { id: newParentId },
        select: { id: true, path: true, kind: true, deletedAt: true },
      })
    : null;
  if (newParentId && !target) throw new NoteError("Destination not found");
  if (target?.deletedAt) throw new NoteError("That folder is in the trash");

  const err = moveError(node, target);
  if (err) throw new NoteError(err);

  const slug = uniqueSlug(slugify(node.title), await liveSiblingSlugs(tx, newParentId, id));
  await tx.noteNode.update({ where: { id }, data: { parentId: newParentId, slug } });
  await rebuildSubtree(tx, id);

  // The destination order is computed as a list and written whole, rather than
  // by parking the row at a sentinel sortOrder and renumbering around it.
  // `sortOrder` is an int4: a sentinel large enough to mean "last" overflows it,
  // and a fractional one to mean "between" is not representable at all.
  const sibs = (
    await tx.noteNode.findMany({
      where: { parentId: newParentId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    })
  ).map((s) => s.id);
  const without = sibs.filter((s) => s !== id);
  const at = index === undefined ? without.length : Math.max(0, Math.min(index, without.length));
  without.splice(at, 0, id);
  await reorderIn(tx, newParentId, without);
  if (node.parentId !== newParentId) await reindex(tx, node.parentId);
}

export async function reorderIn(tx: Tx, parentId: string | null, orderedIds: string[]): Promise<void> {
  // The payload is untrusted — an action POST can name any id at all — so only
  // rows that really are live children of `parentId` are renumbered. Without
  // this, a hostile list reshuffles a branch the caller never opened.
  const own = (await tx.noteNode.findMany({ where: { parentId, deletedAt: null }, select: { id: true } })).map(
    (r) => r.id,
  );
  const mine = new Set(own);
  const ordered = orderedIds.filter((id) => mine.has(id));
  const seen = new Set(ordered);
  const rest = own.filter((id) => !seen.has(id));
  for (const [i, id] of [...ordered, ...rest].entries()) {
    await tx.noteNode.update({ where: { id }, data: { sortOrder: i } });
  }
}

/**
 * Soft delete. The subtree goes with it, and the trashed root's path is moved
 * out of the live namespace under a `~trash/<id>` tombstone.
 *
 * The tombstone is not cosmetic. `path` is UNIQUE, and it has to be — it is the
 * only thing stopping two root folders sharing a name, because Postgres treats
 * the NULL parentIds of root rows as distinct and a UNIQUE(parentId, slug)
 * therefore lets every one of them through. Leaving a trashed `/dsa/dp` sitting
 * on its path means creating a new `/dsa/dp` fails on a unique violation the
 * user cannot explain, which is the bug in this feature most likely to reach
 * production.
 */
export async function trashIn(tx: Tx, id: string): Promise<void> {
  const n = await tx.noteNode.findUniqueOrThrow({ where: { id }, select: { parentId: true, deletedAt: true } });
  if (n.deletedAt) return;
  const ids = await subtreeIds(tx, id);
  await tx.noteNode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
  await tx.noteNode.update({ where: { id }, data: { trashRoot: true } });
  await rebuildSubtree(tx, id);
  await reindex(tx, n.parentId);
}

export async function restoreIn(tx: Tx, id: string): Promise<void> {
  const n = await tx.noteNode.findUniqueOrThrow({
    where: { id },
    select: { parentId: true, title: true, deletedAt: true },
  });
  if (!n.deletedAt) return;
  // Restoring into a parent that is itself in the trash would put the subtree
  // somewhere unreachable, so it goes back to the root instead — visibly, at a
  // place the user can actually find it.
  const parent = n.parentId
    ? await tx.noteNode.findUnique({ where: { id: n.parentId }, select: { deletedAt: true } })
    : null;
  const parentId = parent?.deletedAt ? null : n.parentId;

  const ids = await restorableIds(tx, id);
  await tx.noteNode.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
  const slug = uniqueSlug(slugify(n.title), await liveSiblingSlugs(tx, parentId, id));
  const sortOrder = await tx.noteNode.count({ where: { parentId, deletedAt: null, NOT: { id } } });
  await tx.noteNode.update({ where: { id }, data: { trashRoot: false, parentId, slug, sortOrder } });
  await rebuildSubtree(tx, id);
  await reindex(tx, parentId);
}

export async function duplicateIn(tx: Tx, id: string): Promise<{ id: string; path: string }> {
  const src = await tx.noteNode.findUniqueOrThrow({
    where: { id },
    select: { parentId: true, kind: true, title: true },
  });
  const slug = uniqueSlug(slugify(`${src.title} copy`), await liveSiblingSlugs(tx, src.parentId));
  const sortOrder = await tx.noteNode.count({ where: { parentId: src.parentId, deletedAt: null } });
  const root = await tx.noteNode.create({
    data: {
      parentId: src.parentId,
      kind: src.kind,
      title: `${src.title} (copy)`,
      slug,
      path: placeholder(),
      sortOrder,
    },
    select: { id: true },
  });
  await copyAnswer(tx, id, root.id);
  await copyChildren(tx, id, root.id);
  await rebuildSubtree(tx, root.id);
  return tx.noteNode.findUniqueOrThrow({ where: { id: root.id }, select: { id: true, path: true } });
}

async function copyAnswer(tx: Tx, fromId: string, toId: string) {
  const a = await tx.noteAnswer.findUnique({ where: { nodeId: fromId } });
  if (!a) return;
  await tx.noteAnswer.create({
    data: { nodeId: toId, body: a.body, tags: a.tags, confidence: a.confidence, lastRevisedAt: a.lastRevisedAt },
  });
}

async function copyChildren(tx: Tx, fromId: string, toId: string) {
  const kids = await tx.noteNode.findMany({
    where: { parentId: fromId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, title: true, slug: true, sortOrder: true },
  });
  for (const k of kids) {
    const copy = await tx.noteNode.create({
      data: {
        parentId: toId,
        kind: k.kind,
        title: k.title,
        slug: k.slug,
        path: placeholder(),
        sortOrder: k.sortOrder,
      },
      select: { id: true },
    });
    await copyAnswer(tx, k.id, copy.id);
    await copyChildren(tx, k.id, copy.id);
  }
}

/** Tags are the search language's vocabulary, so they are normalised on the way
 *  in rather than at every point of comparison: `tag:Redis` and `#redis` have to
 *  be one thing, and the GIN index on the column is exact-match. */
export const normaliseTags = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 40);
