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

export function uniqueSlug(base: string, takenSlugs: string[]): string {
  const taken = new Set(takenSlugs);
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function moveError(
  node: { id: string; path: string },
  target: { id: string; path: string; kind: NoteKind } | null,
): string | null {
  if (!target) return null;
  if (target.id === node.id) return "A folder cannot contain itself";
  if (target.kind !== "FOLDER") return "Questions cannot hold children";
  // trailing slash, so /dsa-2 is not a descendant of /dsa
  if (target.path === node.path || target.path.startsWith(node.path + "/"))
    return "Cannot move a folder into its own descendant";
  return null;
}

export const TRASH_PREFIX = "~trash/";

export function tombstone(id: string, path: string): string {
  return `${TRASH_PREFIX}${id}${path}`;
}

export function untomb(path: string): string {
  if (!path.startsWith(TRASH_PREFIX)) return path;
  const rest = path.slice(TRASH_PREFIX.length);
  const cut = rest.indexOf("/");
  return cut === -1 ? "" : rest.slice(cut);
}

export const isOutermostTrashRoot = (r: { id: string; path: string }) =>
  r.path.startsWith(`${TRASH_PREFIX}${r.id}/`);

export function buildTree(rows: TreeRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    // a self-referencing row would become its own child
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

export const normaliseTags = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 40);

export function ancestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
}
