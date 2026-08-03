import { prisma } from "db";
import { TRASH_PREFIX, buildTree, type TreeRow } from "./paths";
import { CONF_LABELS } from "./query";
import { hrefFor, type ChildRow, type Crumb, type TreeItem } from "./view-types";

/**
 * Every read the notes routes make, in one place.
 *
 * The rule the whole section is built on: the tree is loaded ONCE, flat, by the
 * layout, and never again. It carries no answer bodies, it is not paginated and
 * its children are not lazy — at vault scale a single flat query plus an
 * in-memory build beats any lazy scheme and removes an entire class of
 * loading-state bugs along with it.
 */

const TREE_SELECT = {
  id: true,
  parentId: true,
  kind: true,
  title: true,
  slug: true,
  path: true,
  depth: true,
  sortOrder: true,
} as const;

export async function loadTree(): Promise<{ tree: TreeItem[]; trashCount: number }> {
  const [rows, roots] = await Promise.all([
    prisma.noteNode.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: TREE_SELECT,
    }),
    // Counted rather than `count()`d, because the badge means "things you threw
    // away", and a row absorbed into an ancestor's tombstone is not one of them
    // — the same rule the Trash page filters on.
    prisma.noteNode.findMany({
      where: { trashRoot: true, NOT: { deletedAt: null } },
      select: { id: true, path: true },
    }),
  ]);
  const trashCount = roots.filter(isOutermostTrashRoot).length;

  return { tree: withCounts(buildTree(rows as TreeRow[])), trashCount };
}

/** Question totals are folded in during the same walk that builds the tree, so
 *  a collapsed folder can say "12" without the sidebar querying for it. */
function withCounts(nodes: ReturnType<typeof buildTree>): TreeItem[] {
  return nodes.map((n) => {
    const children = withCounts(n.children);
    const own = n.kind === "QUESTION" ? 1 : 0;
    return { ...n, children, questions: own + children.reduce((a, c) => a + c.questions, 0) };
  });
}

/** Breadcrumbs come out of the path string. The ancestors are already loaded in
 *  the layout's tree, so asking the database for them again would be a second
 *  round trip for something we can read off a column. */
export function crumbsFor(path: string, titles: Map<string, string>): Crumb[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, i) => {
    const p = `/${parts.slice(0, i + 1).join("/")}`;
    return { title: titles.get(p) ?? parts[i]!, href: hrefFor(p) };
  });
}

export async function titleByPath(path: string): Promise<Map<string, string>> {
  const parts = path.split("/").filter(Boolean);
  const paths = parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
  const rows = await prisma.noteNode.findMany({
    where: { path: { in: paths } },
    select: { path: true, title: true },
  });
  return new Map(rows.map((r) => [r.path, r.title]));
}

export const confLabel = (c: number) => CONF_LABELS[Math.max(0, Math.min(4, c))]!;

/** The rows a folder overview lists, with the one-line meta each kind wants. */
export async function childRows(parentId: string): Promise<ChildRow[]> {
  const kids = await prisma.noteNode.findMany({
    where: { parentId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, title: true, path: true, answer: { select: { confidence: true } } },
  });

  // One extra query for the whole level rather than one per folder: each folder
  // row wants the questions beneath it, and a prefix count per child would be N
  // round trips for a number the tree already knows how to derive.
  const folderPaths = kids.filter((k) => k.kind === "FOLDER").map((k) => k.path);
  const counts = new Map<string, number>();
  if (folderPaths.length) {
    const below = await prisma.noteNode.findMany({
      where: {
        kind: "QUESTION",
        deletedAt: null,
        OR: folderPaths.map((p) => ({ path: { startsWith: `${p}/` } })),
      },
      select: { path: true },
    });
    for (const q of below) {
      for (const p of folderPaths) if (q.path.startsWith(`${p}/`)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }

  return kids.map((k) => ({
    id: k.id,
    kind: k.kind,
    title: k.title,
    href: hrefFor(k.path),
    meta: k.kind === "FOLDER" ? `${counts.get(k.path) ?? 0} q` : confLabel(k.answer?.confidence ?? 0),
  }));
}

/**
 * Whether a trashed row is one somebody actually threw away, as opposed to one
 * swept up by an ancestor being thrown away.
 *
 * Both are `trashRoot`, because trashing a folder never clears the flag on a
 * note that was already in the trash inside it. What separates them is whose
 * tombstone they are sitting under: `rebuildSubtree` absorbs a nested trash
 * root into its nearest enclosing one, so only the outermost row is parked
 * under its OWN id. Getting this wrong shows the same note twice in the trash
 * and offers a Restore that pulls it out of a folder still in the trash.
 */
export const isOutermostTrashRoot = (r: { id: string; path: string }) =>
  r.path.startsWith(`${TRASH_PREFIX}${r.id}/`);

export async function folderStats(path: string) {
  const below = await prisma.noteNode.findMany({
    where: { deletedAt: null, path: { startsWith: `${path}/` } },
    select: { kind: true, answer: { select: { confidence: true } } },
  });
  const questions = below.filter((n) => n.kind === "QUESTION");
  const solid = questions.filter((n) => (n.answer?.confidence ?? 0) >= 3).length;
  return {
    questions: questions.length,
    folders: below.length - questions.length,
    solidPct: questions.length ? Math.round((solid / questions.length) * 100) : 0,
  };
}
