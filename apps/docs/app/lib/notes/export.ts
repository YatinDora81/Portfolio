import { CONF_LABELS } from "./query";
import type { NoteKind } from "./paths";

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

const YAML_ESC: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

export function yamlString(s: string): string {
  const body = s
    .replace(/[\\"\n\r\t]/g, (c) => YAML_ESC[c]!)
    // eslint-disable-next-line no-control-regex -- matching them is the point
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"${body}"`;
}

const yamlList = (items: string[]): string =>
  items.length ? `[${items.map(yamlString).join(", ")}]` : "[]";

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

export const confidenceLabel = (c: number): string =>
  CONF_LABELS[Math.max(0, Math.min(CONF_LABELS.length - 1, Math.trunc(c) || 0))]!;

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
  for (const r of rows) if (!seen.has(r.id)) out.push(r);
  return out;
}

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

export const VAULT_FORMAT = "yatindora.notes.vault";
export const VAULT_VERSION = 1;

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
    confidence: r.answer?.confidence ?? 0,
    lastRevisedAt: r.answer?.lastRevisedAt ?? null,
  }));

  return `${JSON.stringify({ format: VAULT_FORMAT, version: VAULT_VERSION, exportedAt, count: nodes.length, nodes }, null, 2)}\n`;
}

// eslint-disable-next-line no-control-regex -- a control character in a filename is the case being caught
const ILLEGAL = /[\x00-\x1f<>:"/\\|?*]/g;

const DOS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// utf-16 units, sized so cjk titles stay under 255 bytes
const MAX_STEM = 64;

export function safeFilename(title: string, ext: string): string {
  const suffix = ext ? `.${ext.replace(/^\.+/, "")}` : "";

  let stem = title
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  // the cut can expose a trailing dot or space
  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM).replace(/[.\s]+$/, "");
  if (!stem) stem = "untitled";
  if (DOS_RESERVED.test(stem.split(".")[0]!)) stem = `_${stem}`;

  return `${stem}${suffix}`;
}

export function zipEntryName(path: string, ext: string, under = "/"): string {
  const rest = path.startsWith(under) ? path.slice(under.length) : path;
  return `${rest.replace(/^\/+/, "")}.${ext}`;
}
