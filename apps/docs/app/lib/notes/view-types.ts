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

/**
 * The words under /notes that are rooms of their own rather than notes. Next
 * resolves a static segment before a catch-all, so these URLs never reach the
 * reader — and the two places that decide "is the vault showing" have to agree
 * with the router about it, or a click lands on a URL whose page is still the
 * trash.
 */
const RESERVED = new Set(["search", "trash", "revise", "export"]);

/**
 * Whether some other room owns this URL.
 *
 * Deliberately a separate question from `notePathOf` coming back null, which
 * also answers null for a note URL nobody can decode. The two want opposite
 * things on screen: a sibling route is already rendering its own page and the
 * reader must draw nothing over it, while an undecodable path is a miss the
 * reader owes the user a sentence about.
 */
export function isReservedNotePath(pathname: string): boolean {
  if (pathname !== NOTES_ROOT && !pathname.startsWith(`${NOTES_ROOT}/`)) return true;
  const rest = pathname.slice(NOTES_ROOT.length).split("/").filter(Boolean);
  return rest.length > 0 && RESERVED.has(rest[0]!);
}

/**
 * The vault path a URL is pointing at: "" for the root, null when it is not a
 * note. Null is the load-bearing answer — it is what tells the tree to navigate
 * for real instead of shallowly, because a shallow push away from /notes/trash
 * would change the address bar and leave the trash on screen.
 *
 * Built on the predicate above so the two can never come to disagree about which
 * words are rooms.
 */
export function notePathOf(pathname: string): string | null {
  if (isReservedNotePath(pathname)) return null;
  const rest = pathname.slice(NOTES_ROOT.length).split("/").filter(Boolean);
  if (!rest.length) return "";
  try {
    return "/" + rest.map(decodeURIComponent).join("/");
  } catch {
    // A hand-typed "%E0" is not a note, and a throw here would take the whole
    // sidebar down with it.
    return null;
  }
}
