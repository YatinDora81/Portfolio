import type { NoteKind, TreeNode } from "./paths";

/**
 * The shapes the notes routes hand to their components.
 *
 * They exist because half of these components are client components, and a
 * server component may only pass a client one values that survive
 * serialisation. Every `Date` is therefore already an ISO string by the time it
 * crosses, and the conversion happens once, in the page that loaded the row,
 * rather than being rediscovered at each boundary.
 */

export type { NoteKind, TreeNode };

/** One row of the sidebar tree. Deliberately without an answer body — the tree
 *  query is the one read on every single page in this section. */
export interface TreeItem extends TreeNode {
  children: TreeItem[];
  /** Live questions at or below this node, for the count on a collapsed folder. */
  questions: number;
}

export interface Crumb {
  title: string;
  href: string;
}

export interface AnswerData {
  body: string;
  tags: string[];
  confidence: number;
  lastRevisedAt: string | null;
}

export interface QuestionView {
  id: string;
  title: string;
  path: string;
  href: string;
  crumbs: Crumb[];
  answer: AnswerData;
}

export interface ChildRow {
  id: string;
  kind: NoteKind;
  title: string;
  href: string;
  /** Question count for a folder, confidence label for a question. */
  meta: string;
}

export interface FolderView {
  id: string;
  title: string;
  path: string;
  href: string;
  crumbs: Crumb[];
  children: ChildRow[];
  stats: { questions: number; folders: number; solidPct: number };
}

export interface ResultCard {
  id: string;
  title: string;
  href: string;
  /** Pre-segmented for rendering — never an HTML string. */
  titleParts: { text: string; hit: boolean }[];
  snippet: { text: string; hit: boolean }[];
  tags: string[];
  confidence: number;
  group: string;
}

export interface ReviseCard {
  id: string;
  title: string;
  href: string;
  folder: string;
  body: string;
  confidence: number;
}

export interface TrashRow {
  id: string;
  kind: NoteKind;
  title: string;
  /** The path it will return to, tombstone stripped. */
  homePath: string;
  inside: number;
  deletedAt: string;
}

export const NOTES_ROOT = "/notes";

/** A note's path IS its URL under /notes, which is the whole point of keeping a
 *  materialised path: no lookup table, and a link is derivable anywhere. */
export const hrefFor = (path: string) => `${NOTES_ROOT}${path}`;
