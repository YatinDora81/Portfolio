"use server";

import { prisma } from "db";
import { getSession } from "@/lib/session";
import { isEmptyQuery, parseQuery, snippetParts, terms, highlightParts } from "@/lib/notes/query";
import { toPrismaWhere } from "@/lib/notes/query-sql";
import { hrefFor } from "@/lib/notes/view-types";

export interface PaletteHit {
  id: string;
  href: string;
  titleParts: { text: string; hit: boolean }[];
  snippet: { text: string; hit: boolean }[];
  folder: string;
  confidence: number;
}

const CAP = 20;

export async function searchNotes(raw: string): Promise<{ hits: PaletteHit[]; total: number; bad: string[] }> {
  if (!(await getSession())) return { hits: [], total: 0, bad: [] };

  const q = parseQuery(raw);

  if (isEmptyQuery(q)) {
    const rows = await prisma.noteNode.findMany({
      where: { kind: "QUESTION", deletedAt: null },
      orderBy: [
        { answer: { confidence: "asc" } },
        { answer: { lastRevisedAt: { sort: "asc", nulls: "first" } } },
      ],
      take: 8,
      select: SELECT,
    });
    return { hits: rows.map((r) => toHit(r, q)), total: rows.length, bad: q.bad };
  }

  // `in:` names resolve to paths first; toPrismaWhere only compiles a prefix scan
  const extraInPaths = q.in.length
    ? (
        await prisma.noteNode.findMany({
          where: { kind: "FOLDER", OR: q.in.map((f) => ({ title: { contains: f, mode: "insensitive" as const } })) },
          select: { path: true },
        })
      ).map((r) => r.path)
    : [];

  const where = toPrismaWhere(q, extraInPaths);
  const [rows, total] = await Promise.all([
    prisma.noteNode.findMany({ where, orderBy: { path: "asc" }, take: CAP, select: SELECT }),
    prisma.noteNode.count({ where }),
  ]);

  return { hits: rows.map((r) => toHit(r, q)), total, bad: q.bad };
}

const SELECT = {
  id: true,
  title: true,
  path: true,
  parent: { select: { title: true } },
  answer: { select: { body: true, confidence: true } },
} as const;

type Row = {
  id: string;
  title: string;
  path: string;
  parent: { title: string } | null;
  answer: { body: string; confidence: number } | null;
};

function toHit(r: Row, q: ReturnType<typeof parseQuery>): PaletteHit {
  const ts = terms(q);
  return {
    id: r.id,
    href: hrefFor(r.path),
    // segmented rather than marked up: an html string here is an xss
    titleParts: highlightParts(r.title, ts),
    snippet: ts.length ? snippetParts(r.answer?.body ?? "", q) : [],
    folder: r.parent?.title ?? "the vault",
    confidence: r.answer?.confidence ?? 0,
  };
}
