/**
 * Path arithmetic for the notes vault. Pure by design — no Prisma, no React —
 * because every collision, every cycle and every orphan in the tree is decided
 * in this file, and a mistake here is a wrong row in the database a moment
 * later. Isolated so it can be tested without a connection.
 *
 * `path` is denormalised ancestry ("/dsa/graphs/dijkstra"). It exists so that
 * containment is a string comparison rather than a recursive query, and so that
 * a single unique index can guard names at every level — including the root,
 * where a `[parentId, slug]` index cannot, since Postgres counts every NULL
 * parentId as distinct.
 */

export type NoteKind = "FOLDER" | "QUESTION";

export interface TreeRow {
  id: string;
  parentId: string | null;
  kind: NoteKind;
  title: string;
  slug: string;
  path: string;
  depth: number;
  sortOrder: number;
}

export interface TreeNode extends TreeRow {
  children: TreeNode[];
}

/**
 * Title to path segment. The character class is the load-bearing part: keeping
 * only [a-z0-9 -] is what guarantees a slug can never contain "/" or open with
 * "~", so joining slugs into a path stays unambiguous and no title can forge a
 * trash tombstone. "untitled" is the floor — a title of "???" still has to
 * yield a segment, because an empty one would collapse the path it sits in.
 */
export function slugify(t: string): string {
  return (
    t
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
}

/**
 * A free variant of `base` given the slugs its live siblings already hold: "dp"
 * becomes "dp-2", and "dp-2" in turn becomes "dp-3". The `path` unique index is
 * still what guarantees uniqueness; this exists so the user's reward for naming
 * two folders "DP" is a sensible second name rather than a Prisma P2002.
 */
export function uniqueSlug(base: string, takenSlugs: string[]): string {
  const taken = new Set(takenSlugs);
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

/**
 * Why a move is illegal, or null if it is fine.
 *
 * The descendant check is a prefix comparison on `path`, not a walk up
 * parentId — that is the entire reason `path` is denormalised, and it means the
 * check is free even for a subtree the caller never loaded.
 *
 * The trailing "/" on the prefix is not cosmetic. `target.path.startsWith(
 * node.path)` alone would refuse moving /dsa into its sibling /dsa-2, which is
 * a perfectly ordinary move; only a separator proves descent.
 */
export function moveError(
  node: { id: string; path: string },
  target: { id: string; path: string; kind: NoteKind } | null,
): string | null {
  if (!target) return null; // the root always has room
  if (target.id === node.id) return "A folder cannot contain itself";
  if (target.kind !== "FOLDER") return "Questions cannot hold children";
  if (target.path === node.path || target.path.startsWith(node.path + "/"))
    return "Cannot move a folder into its own descendant";
  return null;
}

export const TRASH_PREFIX = "~trash/";

/**
 * Trashing rewrites the subtree's paths under a tombstone so the live name is
 * free the instant it is trashed. Without it, trashing /dsa/dp and creating a
 * new /dsa/dp trips the `path` unique index against a row the user believes is
 * gone — the failure most likely to reach production. The id is what keeps the
 * tombstone unique, so trashing the same name twice is fine.
 */
export function tombstone(id: string, path: string): string {
  return `${TRASH_PREFIX}${id}${path}`;
}

/**
 * The exact inverse, which restore uses to work out where a row comes back to.
 * A path that was never tombstoned is returned untouched so restore can call it
 * unconditionally. Cutting at the first "/" past the prefix reads the id
 * segment off by structure rather than by a regex that would silently stop
 * matching if TRASH_PREFIX ever changed.
 */
export function untomb(path: string): string {
  if (!path.startsWith(TRASH_PREFIX)) return path;
  const rest = path.slice(TRASH_PREFIX.length);
  const cut = rest.indexOf("/");
  return cut === -1 ? "" : rest.slice(cut);
}

/**
 * Flat rows to a nested tree in one pass. The whole vault is one query and one
 * build; at this scale that beats any lazy scheme and removes a class of
 * loading-state bugs, so do not reach for a recursive CTE.
 *
 * A row whose parentId is missing from `rows` becomes a root rather than being
 * dropped. Callers filter — to live rows, or to search hits — and a filter that
 * removes a parent must not take its children out of the tree with it: a row
 * that renders nowhere cannot be opened, moved or trashed, which is a worse
 * outcome than a row sitting at an unexpected depth.
 */
export function buildTree(rows: TreeRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    // The identity check catches a row pointing at itself; left alone it would
    // become its own child and disappear from the returned tree completely.
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // sortOrder is reindexed per parent and ties easily — mid-move, or on rows
  // seeded at 0. Breaking the tie on id keeps sibling order identical between
  // renders instead of inheriting whatever order the query happened to return.
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * Tags are the search language's vocabulary, so they are normalised on the way
 * in rather than at every point of comparison: `tag:Redis` and `#redis` have to
 * be one thing, and the GIN index on the column is exact-match.
 *
 * It lives here, beside the other pure helpers, because two callers need it from
 * opposite sides of the bundle: `core.ts` writes the column, and `import.ts`
 * normalises a pasted file for a preview that runs in the browser. One
 * definition is what keeps the preview honest about what the write will store.
 */
export const normaliseTags = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 40);

/**
 * Every path from the root down to `path`, the node's own path included. Two
 * callers want exactly that set: revealing a node expands each folder above it,
 * and filtering keeps ancestors visible so a match never appears detached from
 * the branch it lives on.
 */
export function ancestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
}
