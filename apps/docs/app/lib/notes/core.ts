import { Prisma } from "db";
import { slugify, uniqueSlug, moveError, normaliseTags, tombstone, untomb } from "./paths";
import {
  levelOrder,
  planGraft,
  vaultProblems,
  type FolderMode,
  type ImportMode,
  type LiveNode,
  type VaultNode,
} from "./import";

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
  return rebuildSubtrees(tx, [rootId]);
}

/**
 * The same walk over several roots at once, reading the table once for all of
 * them and writing one statement.
 *
 * It exists for the importer, which grafts every root in a file under the same
 * destination. Called per root, an import of two hundred top-level notes reads
 * every row in the table two hundred times inside one interactive transaction —
 * which is how a feature that batches its inserts still manages to be the thing
 * that trips Prisma's transaction budget.
 *
 * The roots must be disjoint. Paths are computed from the snapshot taken before
 * any of them are written, so a root nested inside another would be rebuilt
 * against its parent's stale path.
 */
export async function rebuildSubtrees(tx: Tx, rootIds: string[]): Promise<void> {
  if (!rootIds.length) return;
  const all = (await tx.noteNode.findMany({ select: SHAPE })) as Shape[];
  const byId = new Map(all.map((n) => [n.id, n]));
  const childrenOf = new Map<string, Shape[]>();
  for (const n of all) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

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
  const seen = new Set<string>();
  const walk = (n: Shape, basePath: string, depth: number, tombId: string | null) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
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

  for (const rootId of rootIds) {
    const root = byId.get(rootId);
    if (!root) continue;
    const parent = root.parentId ? byId.get(root.parentId) : null;
    walk(root, parent ? liveOf(parent.path) : "", parent ? parent.depth + 1 : 0, null);
  }

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

/**
 * Close the gaps in one level's `sortOrder`, so it is always 0..n-1.
 *
 * One statement, and only for the rows whose number actually changes — the
 * common case after a trash or a move is that everything below the gap shifts by
 * one and everything above it is already right. Written as a loop of updates
 * this is a round trip per sibling, which an import of a few hundred roots pays
 * inside the same transaction it just batched its inserts into.
 */
export async function reindex(tx: Tx, parentId: string | null) {
  const sibs = await tx.noteNode.findMany({
    where: { parentId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, sortOrder: true },
  });

  const ids: string[] = [];
  const orders: number[] = [];
  for (const [i, s] of sibs.entries()) {
    if (s.sortOrder === i) continue;
    ids.push(s.id);
    orders.push(i);
  }
  if (!ids.length) return;

  await tx.$executeRaw`
    UPDATE "NoteNode" AS n
       SET "sortOrder" = v.ord
      FROM (SELECT * FROM unnest(${ids}::text[], ${orders}::int[]) AS t(id, ord)) AS v
     WHERE n.id = v.id`;
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

/**
 * Graft a parsed file into the tree, under `destParentId` or at the vault root.
 *
 * It takes the already-normalised flat list, so it is shape-agnostic: a vault
 * export and a hand-written nested outline reach this function as the same
 * thing, and there is exactly one insert path to get wrong. What arrives is
 * content — `kind`, `title`, `body`, `tags`, `confidence` — plus `parentId` as
 * structure. Everything positional is recomputed here, because a graft
 * re-parents the file's roots and that invalidates every path beneath them:
 * `slug` against the live siblings, `path` and `depth` by `rebuildSubtree`,
 * `sortOrder` by position among new siblings.
 *
 * **Modes.** `into` mints a fresh id per node and rewrites every `parentId`
 * through the map, so it cannot collide with anything and is the everyday case.
 * `restore` keeps the file's ids verbatim so a vault round-trips exactly, which
 * is only honest into an empty vault — `NoteNode.id` is uuid-defaulted but
 * supplying one is legal, and any collision is a P2002 on the primary key.
 *
 * **On the batching.** Rows go in a level at a time rather than one at a time.
 * A thousand-node restore is otherwise two thousand sequential round trips
 * inside one interactive transaction, which is the P2028 in §13 of the guide
 * waiting to happen against a hosted database. Batching by DEPTH rather than all
 * at once is what keeps the self-referencing `parentId` foreign key trivially
 * satisfied: every parent is already committed by the statement before, so
 * nothing depends on when Postgres fires its constraint triggers.
 */
export async function importIn(
  tx: Tx,
  destParentId: string | null,
  nodes: VaultNode[],
  mode: ImportMode,
  folders: FolderMode = "create",
): Promise<{ created: number; reused: number; rootIds: string[] }> {
  const problems = vaultProblems(nodes);
  if (problems.length) throw new NoteError(problems[0]!);

  if (mode === "restore") {
    if (destParentId !== null) throw new NoteError("Restore rebuilds a whole vault, so it can't be aimed at a folder");
    if ((await tx.noteNode.count()) !== 0) {
      throw new NoteError("Restore only works into an empty vault. Use Import into a folder instead.");
    }
  }

  // The same three checks createIn makes, with the same words. A destination
  // that is a question, or in the trash, fails for the same reason either way.
  if (destParentId) {
    const p = await tx.noteNode.findUnique({
      where: { id: destParentId },
      select: { kind: true, deletedAt: true },
    });
    if (!p) throw new NoteError("That folder no longer exists");
    if (p.kind !== "FOLDER") throw new NoteError("Only folders can hold children");
    if (p.deletedAt) throw new NoteError("That folder is in the trash");
  }

  const levels = levelOrder(nodes);

  // Merging reads the live tree, so it is asked for once rather than a level at
  // a time: the graft can descend into any folder that matches, and finding out
  // which those are one query per level would be a round trip per level of the
  // file. The whole live vault is a few hundred narrow rows — the same bet
  // lib/notes/vault.ts already makes, for the same reason.
  // `restore` rebuilds a whole vault into an empty one, so there is nothing
  // present for it to merge with and the flag is simply not its business.
  const merging = folders === "merge" && mode === "into";
  const live: LiveNode[] = merging
    ? await tx.noteNode.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true, slug: true, kind: true, sortOrder: true },
      })
    : [];

  // The plan is made before a single row is written, by the same function the
  // import dialog previews with. See planGraft in import.ts.
  const plan = planGraft(nodes, destParentId, live, merging ? "merge" : "create");

  const idOf = new Map(
    nodes.map(
      (n) =>
        [n.id, mode === "restore" ? n.id : (plan.merged.get(n.id) ?? crypto.randomUUID())] as const,
    ),
  );

  // Slugs are allocated per parent against an in-memory list. Pushing each
  // result back is what stops two siblings both titled "DP" from both resolving
  // to `dp` and the second dying on the path unique index — and a hand-written
  // outline repeats names constantly, so this is the common case rather than an
  // edge one.
  const taken = new Map<string | null, string[]>();
  // One past the highest number in use, rather than the count. They are the same
  // on a level that has been reindexed and they are not on a level with a gap,
  // where counting would interleave the graft with what is already there.
  const nextOrder = new Map<string | null, number>();

  if (merging) {
    // Every level the graft might land on, seeded from the one read above. A
    // merged folder is appended to, so it needs its own two numbers exactly as
    // the destination does — without this, notes grafted into an existing folder
    // start again at sortOrder 0 and interleave with what is already inside it.
    const maxOrder = new Map<string | null, number>();
    for (const r of live) {
      const list = taken.get(r.parentId);
      if (list) list.push(r.slug);
      else taken.set(r.parentId, [r.slug]);
      maxOrder.set(r.parentId, Math.max(maxOrder.get(r.parentId) ?? -1, r.sortOrder));
    }
    for (const [parentId, max] of maxOrder) nextOrder.set(parentId, max + 1);
    // `liveSiblingSlugs` folds these in for us on the query path; the in-memory
    // seed has to do it by hand, or a root folder titled "Export" would take a
    // slug that shadows a real route.
    taken.set(null, [...(taken.get(null) ?? []), ...RESERVED_ROOT_SLUGS]);
  } else {
    taken.set(destParentId, await liveSiblingSlugs(tx, destParentId));
    const highest = await tx.noteNode.aggregate({
      where: { parentId: destParentId, deletedAt: null },
      _max: { sortOrder: true },
    });
    nextOrder.set(destParentId, (highest._max.sortOrder ?? -1) + 1);
  }

  // Where each of the file's roots ended up, whether it was built or grafted
  // into. Both the path rebuild and the redirect afterwards read this, and a
  // merged root has no new row for them to read instead.
  const rootIds: string[] = [];
  let created = 0;
  const answers: Prisma.NoteAnswerCreateManyInput[] = [];

  for (const [depth, level] of levels.entries()) {
    const rows: Prisma.NoteNodeCreateManyInput[] = [];

    for (const n of level) {
      const id = idOf.get(n.id)!;
      // Already in the vault. `idOf` was pointed at the live folder before the
      // loop began, so this level writes nothing and the next one lands its
      // children inside it — and no slug or sort number is consumed here, which
      // is what keeps a merged folder's existing contents where they are.
      if (plan.merged.has(n.id)) {
        if (depth === 0) rootIds.push(id);
        continue;
      }
      // Level 0 is the file's roots — whatever their parentId claims, the file
      // may not carry the parent it names, and the graft re-parents them here.
      const parentId = depth === 0 ? destParentId : idOf.get(n.parentId!)!;

      let slugs = taken.get(parentId);
      if (!slugs) taken.set(parentId, (slugs = []));
      const slug = uniqueSlug(slugify(n.title), slugs);
      slugs.push(slug);

      const sortOrder = nextOrder.get(parentId) ?? 0;
      nextOrder.set(parentId, sortOrder + 1);

      rows.push({
        id,
        parentId,
        kind: n.kind,
        title: n.title,
        slug,
        // Every row is born on the sentinel: `path` is NOT NULL and UNIQUE and
        // its real value needs the parent's, which is written below.
        path: placeholder(),
        sortOrder,
      });
      // `deletedAt` and `trashRoot` are never read from the file. An import
      // lands in the vault, whatever a hand-edited payload claims.
      if (n.kind === "QUESTION") {
        answers.push({
          nodeId: id,
          body: n.body,
          tags: normaliseTags(n.tags),
          confidence: n.confidence,
          lastRevisedAt: n.lastRevisedAt ?? null,
        });
      }
      if (depth === 0) rootIds.push(id);
    }

    // A level can be empty now: one whose every folder merged writes nothing,
    // and createMany with no rows is a round trip to say so.
    if (rows.length) await tx.noteNode.createMany({ data: rows });
    created += rows.length;
  }

  if (answers.length) await tx.noteAnswer.createMany({ data: answers });

  // Once for the whole graft, outside the insert loop. This is what turns every
  // placeholder into a real path and sets `depth` from the new parentage — the
  // file's own path and depth are never written, at any point above.
  await rebuildSubtrees(tx, rootIds);
  await reindex(tx, destParentId);

  return { created, reused: plan.foldersReused, rootIds };
}

/** Re-exported so every write still reaches it through this module, while the
 *  definition sits in the Prisma-free half the import preview can bundle. */
export { normaliseTags } from "./paths";
