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

// zip.ts needs node:zlib and Buffer
export const runtime = "nodejs";

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

function buildZip(rows: ExportRow[], under: string): Uint8Array<ArrayBuffer> {
  const entries = rows
    .filter((r) => r.kind === "QUESTION")
    .map((r) => ({ name: zipEntryName(r.path, "md", under), data: questionMarkdown(r, r.answer) }));

  entries.push({ name: "vault.json", data: vaultJson(rows) });

  // BodyInit only accepts a view onto a plain ArrayBuffer
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

  // a swept-up descendant still looks live by its path
  const below = (await prisma.noteNode.findMany({
    where: { deletedAt: null, path: { startsWith: `${node.path}/` } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: EXPORT_SELECT,
  })) as DbRow[];

  const rows = [root, ...below.map(toExportRow)];
  const name = safeFilename(node.title, format);
  const under = node.path.slice(0, node.path.lastIndexOf("/") + 1);

  if (format === "json") return send(vaultJson(rows), format, name);
  if (format === "zip") return send(buildZip(rows, under), format, name);
  return send(folderMarkdown(rows), format, name);
}
