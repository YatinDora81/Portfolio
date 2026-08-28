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

export type Tx = Prisma.TransactionClient;

export class NoteError extends Error {}

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

const liveOf = (p: string) => untomb(p);

export async function rebuildSubtree(tx: Tx, rootId: string): Promise<void> {
  return rebuildSubtrees(tx, [rootId]);
}

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

export async function subtreeIds(tx: Tx, rootId: string): Promise<string[]> {
  const all = await tx.noteNode.findMany({ select: { id: true, parentId: true } });
  const childrenOf = new Map<string, string[]>();
  for (const n of all) {
    if (!n.parentId || n.parentId === n.id) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }
  const seen = new Set([rootId]);
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const id of childrenOf.get(out[i]!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export async function restorableIds(tx: Tx, rootId: string): Promise<string[]> {
  const all = await tx.noteNode.findMany({ select: { id: true, parentId: true, trashRoot: true } });
  const childrenOf = new Map<string, { id: string; trashRoot: boolean }[]>();
  for (const n of all) {
    if (!n.parentId || n.parentId === n.id) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }
  const seen = new Set([rootId]);
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const c of childrenOf.get(out[i]!) ?? []) {
      if (c.trashRoot || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
    }
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

// path is not null and unique; rebuildSubtree fills the real value
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
  // the payload is untrusted, so only real children are renumbered
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

async function copyChildren(tx: Tx, fromId: string, toId: string, seen = new Set([fromId, toId])) {
  const kids = await tx.noteNode.findMany({
    where: { parentId: fromId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, title: true, slug: true, sortOrder: true },
  });
  for (const k of kids) {
    if (seen.has(k.id)) continue;
    seen.add(k.id);
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
    seen.add(copy.id);
    await copyAnswer(tx, k.id, copy.id);
    await copyChildren(tx, k.id, copy.id, seen);
  }
}

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

  const merging = folders === "merge" && mode === "into";
  const live: LiveNode[] = merging
    ? await tx.noteNode.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true, slug: true, kind: true, sortOrder: true },
      })
    : [];

  const plan = planGraft(nodes, destParentId, live, merging ? "merge" : "create");

  const idOf = new Map(
    nodes.map(
      (n) =>
        [n.id, mode === "restore" ? n.id : (plan.merged.get(n.id) ?? crypto.randomUUID())] as const,
    ),
  );

  const taken = new Map<string | null, string[]>();
  const nextOrder = new Map<string | null, number>();

  if (merging) {
    const maxOrder = new Map<string | null, number>();
    for (const r of live) {
      const list = taken.get(r.parentId);
      if (list) list.push(r.slug);
      else taken.set(r.parentId, [r.slug]);
      maxOrder.set(r.parentId, Math.max(maxOrder.get(r.parentId) ?? -1, r.sortOrder));
    }
    for (const [parentId, max] of maxOrder) nextOrder.set(parentId, max + 1);
    taken.set(null, [...(taken.get(null) ?? []), ...RESERVED_ROOT_SLUGS]);
  } else {
    taken.set(destParentId, await liveSiblingSlugs(tx, destParentId));
    const highest = await tx.noteNode.aggregate({
      where: { parentId: destParentId, deletedAt: null },
      _max: { sortOrder: true },
    });
    nextOrder.set(destParentId, (highest._max.sortOrder ?? -1) + 1);
  }

  const rootIds: string[] = [];
  let created = 0;
  const answers: Prisma.NoteAnswerCreateManyInput[] = [];

  for (const [depth, level] of levels.entries()) {
    const rows: Prisma.NoteNodeCreateManyInput[] = [];

    for (const n of level) {
      const id = idOf.get(n.id)!;
      if (plan.merged.has(n.id)) {
        if (depth === 0) rootIds.push(id);
        continue;
      }
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
        path: placeholder(),
        sortOrder,
      });
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

    if (rows.length) await tx.noteNode.createMany({ data: rows });
    created += rows.length;
  }

  if (answers.length) await tx.noteAnswer.createMany({ data: answers });

  await rebuildSubtrees(tx, rootIds);
  await reindex(tx, destParentId);

  return { created, reused: plan.foldersReused, rootIds };
}

export { normaliseTags } from "./paths";
