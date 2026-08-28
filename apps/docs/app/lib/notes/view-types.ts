import type { NoteKind, TreeNode } from "./paths";

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
  homePath: string;
  inside: number;
  deletedAt: string;
}

export const NOTES_ROOT = "/notes";

export const hrefFor = (path: string) => `${NOTES_ROOT}${path}`;

const RESERVED = new Set(["search", "trash", "revise", "export"]);

export function isReservedNotePath(pathname: string): boolean {
  if (pathname !== NOTES_ROOT && !pathname.startsWith(`${NOTES_ROOT}/`)) return true;
  const rest = pathname.slice(NOTES_ROOT.length).split("/").filter(Boolean);
  return rest.length > 0 && RESERVED.has(rest[0]!);
}

export function notePathOf(pathname: string): string | null {
  if (isReservedNotePath(pathname)) return null;
  const rest = pathname.slice(NOTES_ROOT.length).split("/").filter(Boolean);
  if (!rest.length) return "";
  try {
    return "/" + rest.map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}
