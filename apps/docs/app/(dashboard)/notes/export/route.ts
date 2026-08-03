import { prisma } from "db";
import { getSession } from "@/lib/session";
import {
  folderMarkdown,
  isExportFormat,
  questionMarkdown,
  safeFilename,
  vaultJson,
  zipEntryName,
  type ExportFormat,
  type ExportRow,
} from "@/lib/notes/export";
import { zipSync } from "@/lib/notes/zip";

/**
 * GET /notes/export?id=<nodeId>&format=md|json|zip
 *
 * **A route handler is not wrapped by a layout.** `(dashboard)/layout.tsx`
 * redirects an anonymous visitor to /login and protects every page under it;
 * this file is not a page and never sees that code. Without the `getSession()`
 * below, one unauthenticated GET returns the entire private vault as a file to
 * anyone who can reach the origin. It is the first statement in the handler for
 * that reason, and nothing may be read before it.
 *
 * A note living at `/export` would be shadowed by this route, since a static
 * segment beats the `[[...segments]]` catch-all beside it. That is what the
 * reserved-root-slug guard in paths.ts exists to prevent at creation time — the
 * name is refused up front rather than producing a folder nobody can open.
 */

/** node:zlib and Buffer are load-bearing in zip.ts; the edge runtime has
 *  neither, so the runtime is pinned rather than inherited. */
export const runtime = "nodejs";

/** Private content that changes under the user's own hands. Never prerendered,
 *  and `Cache-Control: no-store` on every response below says so downstream. */
export const dynamic = "force-dynamic";

const EXPORT_SELECT = {
  id: true,
  parentId: true,
  kind: true,
  title: true,
  slug: true,
  path: true,
  depth: true,
  sortOrder: true,
  deletedAt: true,
  answer: { select: { body: true, tags: true, confidence: true, lastRevisedAt: true } },
} as const;

type DbRow = {
  id: string;
  parentId: string | null;
  kind: "FOLDER" | "QUESTION";
  title: string;
  slug: string;
  path: string;
  depth: number;
  sortOrder: number;
  deletedAt: Date | null;
  answer: { body: string; tags: string[]; confidence: number; lastRevisedAt: Date | null } | null;
};

const toExportRow = (r: DbRow): ExportRow => ({
  id: r.id,
  parentId: r.parentId,
  kind: r.kind,
  title: r.title,
  slug: r.slug,
  path: r.path,
  depth: r.depth,
  sortOrder: r.sortOrder,
  answer: r.answer
    ? { ...r.answer, lastRevisedAt: r.answer.lastRevisedAt?.toISOString() ?? null }
    : null,
});

const fail = (status: number, message: string) =>
  new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

const MIME: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  zip: "application/zip",
};

/**
 * Both spellings of the filename, because neither alone is enough: `filename*`
 * is the one that carries 图论 intact, and the plain `filename` is the fallback
 * for anything that does not implement RFC 5987. encodeURIComponent leaves
 * `!'()*` alone and RFC 5987's attr-char does not allow them, so they are
 * finished off by hand.
 */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const send = (body: string | Uint8Array<ArrayBuffer>, format: ExportFormat, filename: string) =>
  new Response(body, {
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": disposition(filename),
      "Cache-Control": "no-store",
    },
  });

/**
 * A folder or the whole vault as an archive: one .md per question, laid out as
 * the tree is, plus the lossless JSON beside them.
 *
 * Empty folders have no file of their own and would otherwise vanish from the
 * archive — vault.json is what keeps them, which is the other half of why it
 * ships inside every zip rather than only being its own download.
 */
function buildZip(rows: ExportRow[], under: string): Uint8Array<ArrayBuffer> {
  const entries = rows
    .filter((r) => r.kind === "QUESTION")
    .map((r) => ({ name: zipEntryName(r.path, "md", under), data: questionMarkdown(r, r.answer) }));

  entries.push({ name: "vault.json", data: vaultJson(rows) });

  // Node's Buffer is a Uint8Array over an ArrayBufferLike — possibly a slice of
  // a shared pool — and `BodyInit` only accepts a view onto a plain ArrayBuffer.
  // Copying onto one is the conversion, not a workaround for the type: it is
  // also what stops the response body aliasing pooled memory.
  const bytes = zipSync(entries);
  const body = new Uint8Array(new ArrayBuffer(bytes.length));
  body.set(bytes);
  return body;
}

export async function GET(request: Request) {
  if (!(await getSession())) return fail(401, "Unauthorized");

  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "md";
  if (!isExportFormat(format)) return fail(400, `Unknown format "${format}". Expected md, json or zip.`);

  const id = params.get("id");

  // No id is the whole vault. Every question in it, in one file or one archive.
  if (!id) {
    const rows = (await prisma.noteNode.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: EXPORT_SELECT,
    })) as DbRow[];
    const all = rows.map(toExportRow);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = safeFilename(`notes-vault-${stamp}`, format);

    if (format === "json") return send(vaultJson(all), format, name);
    if (format === "zip") return send(buildZip(all, "/"), format, name);
    return send(folderMarkdown(all), format, name);
  }

  const node = (await prisma.noteNode.findUnique({ where: { id }, select: EXPORT_SELECT })) as DbRow | null;
  // `deletedAt`, not the tombstone in `path`: only the node that was explicitly
  // trashed carries a tombstone, so a descendant swept up with it still looks
  // live by its path alone and would export from under the trash.
  if (!node || node.deletedAt) return fail(404, "No such note");

  const root = toExportRow(node);

  if (node.kind === "QUESTION") {
    if (format === "zip") return fail(400, "A single question exports as md or json, not zip.");
    const name = safeFilename(node.title, format);
    return send(
      format === "json" ? vaultJson([root]) : questionMarkdown(root, root.answer),
      format,
      name,
    );
  }

  // The prefix alone is not the filter. A trashed folder keeps its children on
  // live-looking paths — only the trashed node itself is tombstoned — so
  // `deletedAt: null` is what actually stops deleted notes leaving the vault
  // inside somebody's export.
  const below = (await prisma.noteNode.findMany({
    where: { deletedAt: null, path: { startsWith: `${node.path}/` } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: EXPORT_SELECT,
  })) as DbRow[];

  const rows = [root, ...below.map(toExportRow)];
  const name = safeFilename(node.title, format);
  // Everything above the exported folder is dropped from the entry names, so
  // the archive opens at the folder that was asked for.
  const under = node.path.slice(0, node.path.lastIndexOf("/") + 1);

  if (format === "json") return send(vaultJson(rows), format, name);
  if (format === "zip") return send(buildZip(rows, under), format, name);
  return send(folderMarkdown(rows), format, name);
}
