import { ancestorPaths, buildTree, type TreeRow } from "./paths";
import { confLabel } from "./query";
import { hrefFor, type ChildRow, type Crumb, type FolderView, type QuestionView } from "./view-types";

export interface VaultAnswer {
  body: string;
  tags: string[];
  confidence: number;
  lastRevisedAt: string | null;
}

export interface VaultRow extends TreeRow {
  answer: VaultAnswer | null;
}

export interface VaultPayload {
  rows: VaultRow[];
  trashCount: number;
  vaultEmpty: boolean;
}

export interface VaultItem extends VaultRow {
  children: VaultItem[];
  questions: number;
}

interface Below {
  questions: number;
  folders: number;
  solid: number;
}

export interface VaultIndex {
  rows: VaultRow[];
  tree: VaultItem[];
  byPath: Map<string, VaultRow>;
  byId: Map<string, VaultRow>;
  // "" is the vault root
  kids: Map<string, VaultRow[]>;
  below: Map<string, Below>;
  trashCount: number;
  vaultEmpty: boolean;
}

const SIBLING_CAP = 12;

// `good` and up
const SOLID = 3;

const ROOT_KEY = "";

export function indexVault(
  payload: VaultPayload,
  ratings?: ReadonlyMap<string, number>,
): VaultIndex {
  const rows =
    ratings?.size
      ? payload.rows.map((r) =>
          r.answer && ratings.has(r.id)
            ? { ...r, answer: { ...r.answer, confidence: ratings.get(r.id)! } }
            : r,
        )
      : payload.rows;

  const tree = withCounts(buildTree(rows) as unknown as VaultItem[]);

  const byPath = new Map<string, VaultRow>();
  const byId = new Map<string, VaultRow>();
  const kids = new Map<string, VaultRow[]>();
  const below = new Map<string, Below>();

  const bump = (path: string, row: VaultRow) => {
    let b = below.get(path);
    if (!b) below.set(path, (b = { questions: 0, folders: 0, solid: 0 }));
    if (row.kind !== "QUESTION") {
      b.folders++;
      return;
    }
    b.questions++;
    if ((row.answer?.confidence ?? 0) >= SOLID) b.solid++;
  };

  const walk = (list: VaultItem[], parentKey: string) => {
    kids.set(parentKey, list);
    for (const node of list) {
      byPath.set(node.path, node);
      byId.set(node.id, node);
      for (const p of ancestorPaths(node.path).slice(0, -1)) bump(p, node);
      if (node.children.length) walk(node.children, node.id);
    }
  };
  walk(tree, ROOT_KEY);

  return { rows, tree, byPath, byId, kids, below, trashCount: payload.trashCount, vaultEmpty: payload.vaultEmpty };
}

function withCounts(nodes: VaultItem[]): VaultItem[] {
  for (const n of nodes) {
    withCounts(n.children);
    n.questions =
      (n.kind === "QUESTION" ? 1 : 0) + n.children.reduce((a, c) => a + c.questions, 0);
  }
  return nodes;
}

export function crumbsIn(ix: VaultIndex, path: string): Crumb[] {
  return ancestorPaths(path).map((p) => ({
    title: ix.byPath.get(p)?.title ?? p.split("/").pop()!,
    href: hrefFor(p),
  }));
}

export function siblingsIn(ix: VaultIndex, row: VaultRow): { id: string; title: string; href: string }[] {
  return (ix.kids.get(row.parentId ?? ROOT_KEY) ?? [])
    .filter((s) => s.kind === "QUESTION" && s.id !== row.id)
    .slice(0, SIBLING_CAP)
    .map((s) => ({ id: s.id, title: s.title, href: hrefFor(s.path) }));
}

export interface NextQuestion {
  id: string;
  title: string;
  href: string;
  parentTitle: string;
  sameFolder: boolean;
}

export function nextQuestionIn(ix: VaultIndex, row: VaultRow): NextQuestion | null {
  const order: VaultRow[] = [];
  const walk = (list: VaultItem[]) => {
    for (const n of list) {
      if (n.kind === "QUESTION") order.push(n);
      if (n.children.length) walk(n.children);
    }
  };
  walk(ix.tree);

  const at = order.findIndex((q) => q.id === row.id);
  const next = at === -1 ? undefined : order[at + 1];
  if (!next) return null;

  return {
    id: next.id,
    title: next.title,
    href: hrefFor(next.path),
    parentTitle: next.parentId ? (ix.byId.get(next.parentId)?.title ?? "the vault") : "the vault",
    sameFolder: (next.parentId ?? ROOT_KEY) === (row.parentId ?? ROOT_KEY),
  };
}

export function childRowsIn(ix: VaultIndex, row: VaultRow): ChildRow[] {
  return (ix.kids.get(row.id) ?? []).map((k) => ({
    id: k.id,
    kind: k.kind,
    title: k.title,
    href: hrefFor(k.path),
    meta:
      k.kind === "FOLDER"
        ? `${ix.below.get(k.path)?.questions ?? 0} q`
        : confLabel(k.answer?.confidence ?? 0),
  }));
}

export function folderStatsIn(ix: VaultIndex, path: string): FolderView["stats"] {
  const b = ix.below.get(path);
  const questions = b?.questions ?? 0;
  return {
    questions,
    folders: b?.folders ?? 0,
    solidPct: questions ? Math.round(((b?.solid ?? 0) / questions) * 100) : 0,
  };
}

export function questionViewIn(ix: VaultIndex, row: VaultRow): QuestionView {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    href: hrefFor(row.path),
    crumbs: crumbsIn(ix, row.path),
    answer: {
      body: row.answer?.body ?? "",
      tags: row.answer?.tags ?? [],
      confidence: row.answer?.confidence ?? 0,
      lastRevisedAt: row.answer?.lastRevisedAt ?? null,
    },
  };
}

export function folderViewIn(ix: VaultIndex, row: VaultRow): FolderView {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    href: hrefFor(row.path),
    crumbs: crumbsIn(ix, row.path),
    children: childRowsIn(ix, row),
    stats: folderStatsIn(ix, row.path),
  };
}

export function parentTitleIn(crumbs: Crumb[]): string {
  return crumbs.length > 1 ? crumbs[crumbs.length - 2]!.title : "the vault";
}
