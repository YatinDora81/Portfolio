import { ancestorPaths, buildTree, type TreeRow } from "./paths";
import { confLabel } from "./query";
import { hrefFor, type ChildRow, type Crumb, type FolderView, type QuestionView } from "./view-types";

/**
 * The whole vault as one value, and every view the notes pane draws derived
 * from it — in memory, synchronously, with no database anywhere in this file.
 *
 * The section used to read the tree in the layout and then run three or four
 * MORE queries per note: the row, its ancestors' titles, its siblings or its
 * folder's children and stats. Each of those is a round trip to Neon, they run
 * one after another, and at ~90ms each that is most of a second of waiting
 * between clicking a question and reading it. None of them ask for anything the
 * first query did not already have in the room.
 *
 * So there is one query now, it carries the answer bodies with it, and
 * everything else is arithmetic over the result. The measurement that makes
 * that reasonable: 436 live rows, 386 answers, 247k characters of prose — 420 KB
 * of JSON, once, for a vault it takes years to write. Opening a note after that
 * costs a Map lookup.
 *
 * Nothing here imports Prisma, because all of it runs in the browser too: the
 * provider hands these functions the same payload the server rendered from, and
 * moving between notes never leaves the tab. Keep it that way — one `db` import
 * in this file and the whole pane stops being client-renderable.
 */

export interface VaultAnswer {
  body: string;
  tags: string[];
  confidence: number;
  lastRevisedAt: string | null;
}

/** One live row, with its answer already beside it rather than a join away. */
export interface VaultRow extends TreeRow {
  /** Null on every folder, and on a question inserted around the app. */
  answer: VaultAnswer | null;
}

/** What the layout ships. Deliberately flat: `buildTree` is pure and cheap, so
 *  sending the nested shape as well would put every title on the wire twice. */
export interface VaultPayload {
  rows: VaultRow[];
  trashCount: number;
  vaultEmpty: boolean;
}

export interface VaultItem extends VaultRow {
  children: VaultItem[];
  /** Live questions at or below this node, for the count on a collapsed folder. */
  questions: number;
}

/** Live descendants of one folder path, counted in the single walk below. */
interface Below {
  questions: number;
  folders: number;
  /** Of those questions, the ones rated `good` or `solid`. */
  solid: number;
}

export interface VaultIndex {
  rows: VaultRow[];
  tree: VaultItem[];
  byPath: Map<string, VaultRow>;
  byId: Map<string, VaultRow>;
  /** Children in sibling order, keyed by parentId — "" is the vault root. */
  kids: Map<string, VaultRow[]>;
  below: Map<string, Below>;
  trashCount: number;
  vaultEmpty: boolean;
}

/** The strip under an answer. Long enough to be a way sideways, short enough
 *  not to become a second table of contents. */
const SIBLING_CAP = 12;

/** `good` and up. The same threshold the folder overview has always called solid. */
const SOLID = 3;

const ROOT_KEY = "";

/**
 * One walk, four indexes.
 *
 * Sibling order is read off the built tree rather than off the query, so the
 * strip under an answer and the rows in a folder overview cannot end up in a
 * different order from the sidebar — `buildTree` is the only place that decides
 * what "next" means, ties on sortOrder included.
 *
 * One asymmetry is inherited rather than fixed, and is pinned by a test so it
 * cannot drift: a row whose `parentId` names a node that is not in the payload
 * is promoted to a root by `buildTree` and counted toward its path's ancestors
 * by `below` — but `kids` never files it under the parent it claims, so its
 * sibling strip comes back empty. The query this replaced had exactly the same
 * hole, for exactly the same reason.
 */
export function indexVault(
  payload: VaultPayload,
  /** Ratings this tab has made that `payload` has not caught up with. */
  ratings?: ReadonlyMap<string, number>,
): VaultIndex {
  // The overlay lands here and nowhere else. Every view below reads these rows,
  // so applying it at the index is what makes a rating true in the folder
  // percentage, the child-row label, the sibling strip and the `conf:` filter in
  // the same frame — with no second copy of the number for them to disagree over.
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
      // Every folder above it, itself excluded: a folder does not contain
      // itself, and the overview's three numbers say what is *inside*.
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

/**
 * Breadcrumbs out of the path string. The ancestors are already in the payload,
 * so asking for their titles would be a round trip for something we can read
 * off a column — and the fallback keeps a crumb rendering even if one is not.
 */
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

/** Where one scroll gesture past the end of an answer lands. */
export interface NextQuestion {
  id: string;
  title: string;
  href: string;
  /** The folder the next question lives in — the strip names it when crossing. */
  parentTitle: string;
  /** False exactly when following it leaves the current folder. */
  sameFolder: boolean;
}

/**
 * The question after this one in reading order: the depth-first walk the
 * sidebar draws, questions only. Crossing a folder boundary is deliberate —
 * the last question in a folder continues into the next folder's first, and a
 * level that runs out climbs to the parent and carries on — so one gesture can
 * read the vault end to end. `null` only on the vault's final question, the one
 * place "next" honestly has no answer.
 *
 * The walk is over `ix.tree` rather than the `kids` map so that ties, promoted
 * orphans and every other ordering question stay answered in exactly one place:
 * `buildTree`. At vault scale — hundreds of rows — flattening on demand is a
 * fraction of a millisecond, which is cheaper than keeping a fifth index right.
 */
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

/** What the sibling strip is labelled with — the folder you are standing in. */
export function parentTitleIn(crumbs: Crumb[]): string {
  return crumbs.length > 1 ? crumbs[crumbs.length - 2]!.title : "the vault";
}
