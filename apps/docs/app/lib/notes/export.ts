import { CONF_LABELS } from "./query";
import type { NoteKind } from "./paths";

/**
 * The vault's serialisers. Pure by design — no Prisma, no React, no `Response` —
 * so the shape of a .md file and the shape of a .json file are decided here and
 * tested here, and the route handler is left doing nothing but authenticating,
 * loading rows and setting headers.
 *
 * Three formats, because they answer three different questions. Markdown is for
 * reading the vault somewhere else (Obsidian, a gist, a printer). JSON is for
 * getting it back in. A zip is markdown plus that JSON, for the case where the
 * answer to "what do I do with this" is "keep it".
 */

/** The node columns an export reads — the tree query's projection, unchanged. */
export interface ExportNode {
  id: string;
  parentId: string | null;
  kind: NoteKind;
  title: string;
  slug: string;
  path: string;
  depth: number;
  sortOrder: number;
}

/** The answer columns. Null for a folder, which never owns a NoteAnswer row. */
export interface ExportAnswer {
  body: string;
  tags: string[];
  confidence: number;
  lastRevisedAt: string | null;
}

export interface ExportRow extends ExportNode {
  answer: ExportAnswer | null;
}

export const EXPORT_FORMATS = ["md", "json", "zip"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const isExportFormat = (s: string): s is ExportFormat =>
  (EXPORT_FORMATS as readonly string[]).includes(s);

/* ------------------------------------------------------------------ YAML -- */

const YAML_ESC: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * Every string in the front matter is double-quoted, unconditionally.
 *
 * The tempting version emits bare scalars and quotes only when it has to, which
 * reads better and is a second YAML parser hiding in a helper. The strings that
 * MUST be quoted are not a short list: anything holding ": " or " #", anything
 * opening with one of `-?:,[]{}#&*!|>'"%@\``, anything ending in a colon or a
 * space, and every word YAML resolves to another type — true, false, null, yes,
 * no, on, off, ~, 3, 3.0, 2026-08-03. A title of "Is it O(1)?" or "yes" or
 * "Dijkstra: shortest path" is an ordinary title, and each one breaks a
 * different clause of that list. Quoting always has no clauses to get wrong.
 */
export function yamlString(s: string): string {
  const body = s
    .replace(/[\\"\n\r\t]/g, (c) => YAML_ESC[c]!)
    // Whatever control characters survive the named escapes above cannot appear
    // raw inside a double-quoted scalar; \uXXXX is the escape YAML defines.
    // eslint-disable-next-line no-control-regex -- matching them is the point
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${body}"`;
}

const yamlList = (items: string[]): string =>
  items.length ? `[${items.map(yamlString).join(", ")}]` : "[]";

/** Headings and front matter are line-oriented; a title carrying a newline
 *  would end the block early and turn the rest of it into body text. */
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

export const confidenceLabel = (c: number): string =>
  CONF_LABELS[Math.max(0, Math.min(CONF_LABELS.length - 1, Math.trunc(c) || 0))]!;

/* -------------------------------------------------------------- markdown -- */

/**
 * One question, one .md file: front matter, the title as an H1, then the body
 * exactly as it was written. The body is NOT escaped or re-wrapped — it is
 * already markdown, and the whole value of this format is that what comes out
 * is what was typed.
 */
export function questionMarkdown(
  node: Pick<ExportNode, "title" | "path">,
  answer: ExportAnswer | null,
): string {
  const front = [
    "---",
    `title: ${yamlString(oneLine(node.title))}`,
    `path: ${yamlString(node.path)}`,
    `tags: ${yamlList(answer?.tags ?? [])}`,
    `confidence: ${yamlString(confidenceLabel(answer?.confidence ?? 0))}`,
    `lastRevisedAt: ${answer?.lastRevisedAt ? yamlString(answer.lastRevisedAt) : "null"}`,
    "---",
  ].join("\n");

  const body = (answer?.body ?? "").replace(/\s+$/, "");
  return `${front}\n\n# ${oneLine(node.title)}\n${body ? `\n${body}\n` : ""}`;
}

/**
 * Rows depth-first in the order the sidebar shows them.
 *
 * "Parent not in the set" is what counts as a root here, not "parentId is
 * null" — a folder export selects a subtree whose topmost row points at a
 * parent that was deliberately left out, and reading that pointer literally
 * would drop the entire export on the floor.
 */
export function treeOrder<T extends { id: string; parentId: string | null; sortOrder: number }>(
  rows: T[],
): T[] {
  const present = new Set(rows.map((r) => r.id));
  const kids = new Map<string | null, T[]>();
  for (const r of rows) {
    const key = r.parentId !== null && present.has(r.parentId) && r.parentId !== r.id ? r.parentId : null;
    const list = kids.get(key);
    if (list) list.push(r);
    else kids.set(key, [r]);
  }
  // Same tie-break as buildTree: sortOrder ties on freshly seeded rows, and id
  // keeps two exports of an unchanged vault byte-identical.
  for (const list of kids.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (key: string | null) => {
    for (const r of kids.get(key) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      walk(r.id);
    }
  };
  walk(null);
  // A parent cycle would strand its members outside the walk. Append them
  // rather than lose them: an export that silently omits notes is the one
  // failure this file must not have.
  for (const r of rows) if (!seen.has(r.id)) out.push(r);
  return out;
}

/**
 * A whole subtree as one markdown document. Heading depth tracks tree depth so
 * the file's outline IS the folder structure — which is what makes it usable in
 * anything that renders a table of contents. h6 is the floor markdown gives us;
 * past that, nesting is carried by the path line under each heading instead.
 */
export function folderMarkdown(rows: ExportRow[]): string {
  if (!rows.length) return "";
  const ordered = treeOrder(rows);
  const base = Math.min(...rows.map((r) => r.depth));

  const blocks = ordered.map((row) => {
    const hashes = "#".repeat(Math.min(6, Math.max(1, row.depth - base + 1)));
    const meta = [`\`${row.path}\``];
    if (row.kind === "QUESTION") meta.push(confidenceLabel(row.answer?.confidence ?? 0));
    const tags = row.answer?.tags ?? [];
    if (tags.length) meta.push(tags.map((t) => `\`${t}\``).join(" "));

    const body = (row.answer?.body ?? "").replace(/\s+$/, "");
    return [`${hashes} ${oneLine(row.title)}`, meta.join(" · "), body].filter(Boolean).join("\n\n");
  });

  return `${blocks.join("\n\n")}\n`;
}

/* ------------------------------------------------------------------ JSON -- */

export const VAULT_FORMAT = "yatindora.notes.vault";
export const VAULT_VERSION = 1;

/**
 * The lossless format: every column, nothing derived, nothing dropped.
 *
 * **On ids.** They are exported so `parentId` resolves inside the file, but
 * they are this database's uuids. An importer has exactly two honest options.
 * Restoring into an EMPTY vault, it can keep them verbatim and the file
 * round-trips exactly. Merging into a vault that may already hold them, it must
 * mint a fresh id per node and rewrite every `parentId` through an old→new map
 * built in a first pass — and then it must recompute `path` and `depth` from
 * the new parentage rather than trusting the exported strings, because a merge
 * re-parents the top of the file somewhere else and that invalidates every path
 * beneath it. `sortOrder` is only meaningful among siblings, so it is reindexed
 * per parent after the merge, never taken as a global rank.
 *
 * `nodes` is in tree order, which means a parent always precedes its children.
 * An importer can therefore insert row by row in one pass without deferring the
 * `parentId` foreign key.
 *
 * A FOLDER carries `body: ""`, `tags: []`, `confidence: 0`, `lastRevisedAt:
 * null` — the flat shape cannot distinguish "no NoteAnswer row" from "an empty
 * one", and does not need to: the schema gives an answer row to questions and
 * to nothing else, so `kind` already carries that fact.
 */
export function vaultJson(rows: ExportRow[], exportedAt: string = new Date().toISOString()): string {
  const nodes = treeOrder(rows).map((r) => ({
    id: r.id,
    parentId: r.parentId,
    kind: r.kind,
    title: r.title,
    slug: r.slug,
    path: r.path,
    depth: r.depth,
    sortOrder: r.sortOrder,
    body: r.answer?.body ?? "",
    tags: r.answer?.tags ?? [],
    // The integer is the stored value; the label is CONF_LABELS[confidence] and
    // is deliberately not written, so the two can never disagree in a file.
    confidence: r.answer?.confidence ?? 0,
    lastRevisedAt: r.answer?.lastRevisedAt ?? null,
  }));

  return `${JSON.stringify({ format: VAULT_FORMAT, version: VAULT_VERSION, exportedAt, count: nodes.length, nodes }, null, 2)}\n`;
}

/* -------------------------------------------------------------- filename -- */

/** Illegal on Windows, and `/` and `:` are illegal or hostile on the other two. */
// eslint-disable-next-line no-control-regex -- a control character in a filename is the case being caught
const ILLEGAL = /[\x00-\x1f<>:"/\\|?*]/g;

/**
 * Reserved device names on Windows — still reserved WITH an extension, which is
 * the half everyone forgets: CON.md cannot be created either.
 */
const DOS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Long enough to stay recognisable, short enough that the deepest path in a zip
 * clears Windows' 260-character limit with room to spare. Counted in UTF-16
 * units, and the cap is set against the worst ratio those have in UTF-8 — CJK,
 * at three bytes each — so even an all-Chinese title lands under a 255-byte
 * filesystem limit with the extension attached.
 */
const MAX_STEM = 64;

/**
 * A filename that lands intact on Windows, macOS and Linux.
 *
 * The truncation and the trailing-character strip are ordered, not stacked in
 * whatever order read well: cutting to MAX_STEM can itself expose a trailing
 * space or dot, so the strip has to run again AFTER the cut. Getting that
 * backwards produces a name that is fine locally and rejected on extraction —
 * which is the failure nobody sees until someone unzips it on Windows.
 */
export function safeFilename(title: string, ext: string): string {
  const suffix = ext ? `.${ext.replace(/^\.+/, "")}` : "";

  let stem = title
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Leading dots make a hidden file on unix and a bare "." or ".." is not a
    // name at all; trailing dots and spaces are silently eaten by Windows.
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM).replace(/[.\s]+$/, "");
  if (!stem) stem = "untitled";
  // Windows resolves a device name from the text before the FIRST dot, so
  // "CON.md" is as reserved as "CON" and a title of either has to be moved out
  // of the way before the extension is appended.
  if (DOS_RESERVED.test(stem.split(".")[0]!)) stem = `_${stem}`;

  return `${stem}${suffix}`;
}

/**
 * Zip entry names, unlike download filenames, are guaranteed unique for free:
 * they are built from `path`, and `path` carries a unique index. Slugs are
 * already [a-z0-9-] by construction, so no segment needs sanitising and no
 * collision counter is needed on top.
 *
 * `under` is the ancestry to drop, so a subtree export opens at the folder that
 * was asked for rather than burying it under empty copies of its parents.
 */
export function zipEntryName(path: string, ext: string, under = "/"): string {
  const rest = path.startsWith(under) ? path.slice(under.length) : path;
  return `${rest.replace(/^\/+/, "")}.${ext}`;
}
