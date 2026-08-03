"use server";

import { prisma } from "db";
import { getSession } from "@/lib/session";
import { isEmptyQuery, parseQuery, snippetParts, terms, highlightParts } from "@/lib/notes/query";
import { toPrismaWhere } from "@/lib/notes/query-sql";
import { hrefFor } from "@/lib/notes/view-types";

/**
 * What ⌘K asks the vault.
 *
 * It is a read, but it is still a `"use server"` export and therefore still a
 * public POST endpoint — so it proves the session like every writer does. A
 * search endpoint that skips the check leaks the same private content as a
 * download endpoint that skips it, one page of results at a time.
 *
 * The palette runs this rather than a matcher of its own, so `tag:redis` and
 * `conf:<=2` mean in the palette exactly what they mean in the tree filter and
 * on the search page — one parser, one set of semantics, three places to type
 * into. Loading the whole vault into the palette would have been the other
 * option and would put every answer body in the bundle of every admin page.
 */

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

  // Nothing typed yet: the palette opens on the revise queue instead of on
  // nothing, because "what am I worst at" is a better default than a blank list.
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

  // `in:` by folder name is resolved to paths first — toPrismaWhere compiles a
  // prefix scan and cannot do a lookup of its own.
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
    // Segmented rather than marked up: the palette renders <mark> elements, and
    // an HTML string built from an answer body is an XSS in an authenticated
    // admin session.
    titleParts: highlightParts(r.title, ts),
    snippet: ts.length ? snippetParts(r.answer?.body ?? "", q) : [],
    folder: r.parent?.title ?? "the vault",
    confidence: r.answer?.confidence ?? 0,
  };
}
