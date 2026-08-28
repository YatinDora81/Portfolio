import { prisma } from "db";
import { ancestorPaths, untomb } from "@/lib/notes/paths";
import {
  highlightParts, isEmptyQuery, parseQuery, snippetParts, terms, type ParsedQuery,
} from "@/lib/notes/query";
import { toPrismaWhere } from "@/lib/notes/query-sql";
import { NOTES_ROOT, hrefFor, type ResultCard } from "@/lib/notes/view-types";
import { SearchBox } from "../components/search-box";
import { SearchResults } from "../components/search-results";

export const dynamic = "force-dynamic";

const LIMIT = 200;

const FACETS = 16;

export default async function NotesSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.q) ? sp.q.at(-1) : sp.q) ?? "";
  const q = parseQuery(raw);
  const empty = isEmptyQuery(q);

  const rows = empty ? [] : await search(q);
  const hits = rows.slice(0, LIMIT);

  const titles = await folderTitles(hits.map((h) => h.path));
  const ts = terms(q);
  const trash = q.is.includes("trashed") ? `${NOTES_ROOT}/trash` : null;
  const cards: ResultCard[] = hits.map((h) => ({
    id: h.id,
    title: h.title,
    href: trash ?? hrefFor(h.path),
    titleParts: highlightParts(h.title, ts),
    snippet: snippetParts(h.answer?.body ?? "", q),
    tags: h.answer?.tags ?? [],
    confidence: h.answer?.confidence ?? 0,
    group: groupOf(h.path, titles),
  }));

  const facets = await facetsFor(hits, empty);

  return (
    <>
      <SearchBox
        q={raw}
        count={hits.length}
        capped={rows.length > LIMIT}
        facets={facets}
        fromResults={!empty}
      />
      <SearchResults q={q} cards={cards} />
    </>
  );
}

async function search(q: ParsedQuery) {
  const names = q.in.filter((f) => !f.startsWith("/"));
  const folders = names.length
    ? await prisma.noteNode.findMany({
        where: {
          kind: "FOLDER",
          deletedAt: null,
          OR: names.map((f) => ({ title: { contains: f, mode: "insensitive" as const } })),
        },
        select: { path: true },
      })
    : [];

  return prisma.noteNode.findMany({
    where: toPrismaWhere(q, folders.map((f) => f.path)),
    orderBy: { path: "asc" },
    // One over the cap, so "there are more than this" costs no second query.
    take: LIMIT + 1,
    select: {
      id: true,
      title: true,
      path: true,
      answer: { select: { body: true, tags: true, confidence: true } },
    },
  });
}

async function facetsFor(hits: { answer: { tags: string[] } | null }[], empty: boolean) {
  const rows = empty
    ? await prisma.noteAnswer.findMany({ where: { node: { deletedAt: null } }, select: { tags: true } })
    : hits.map((h) => ({ tags: h.answer?.tags ?? [] }));

  const counts = new Map<string, number>();
  for (const r of rows) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);

  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, FACETS)
    .map(([tag, count]) => ({ tag, count }));
}

const home = (path: string) => untomb(path) || path;

async function folderTitles(paths: string[]): Promise<Map<string, string>> {
  const above = [...new Set(paths.flatMap((p) => ancestorPaths(home(p)).slice(0, -1)))];
  if (!above.length) return new Map();
  const rows = await prisma.noteNode.findMany({
    where: { path: { in: above } },
    select: { path: true, title: true },
  });
  return new Map(rows.map((r) => [r.path, r.title]));
}

function groupOf(path: string, titles: Map<string, string>): string {
  const chain = ancestorPaths(home(path)).slice(0, -1);
  if (!chain.length) return "the vault";
  return chain.map((p) => titles.get(p) ?? p.split("/").pop()!).join(" / ");
}
