import { prisma } from "db";
import { ancestorPaths, untomb } from "@/lib/notes/paths";
import {
  highlightParts, isEmptyQuery, parseQuery, snippetParts, terms, type ParsedQuery,
} from "@/lib/notes/query";
import { toPrismaWhere } from "@/lib/notes/query-sql";
import { NOTES_ROOT, hrefFor, type ResultCard } from "@/lib/notes/view-types";
import { SearchBox } from "../components/search-box";
import { SearchResults } from "../components/search-results";

/** The vault changes under the user's own hands; a cached result set would
 *  answer with notes they have already edited, moved or trashed. */
export const dynamic = "force-dynamic";

/**
 * Results per page. A bare `is:solid` can name most of the vault, and every row
 * of it carries a snippet — the cap is what keeps one lazy query from shipping
 * the whole database into a document.
 */
const LIMIT = 200;

/** Enough tags to read the shape of a result set; more is a wall of pills. */
const FACETS = 16;

/**
 * /notes/search?q=… — the whole search, in one request.
 *
 * `q` is the state. The page parses it, compiles it and renders it, so a search
 * is a URL you can bookmark, share and reload, and the box on top of it is an
 * enhancement rather than the mechanism. Nothing here needs the client to have
 * booted.
 */
export default async function NotesSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  // `?q=` may legally repeat, and a hand-built link is enough to do it. The last
  // one is what a browser would have submitted, so it is the query that ran.
  const raw = (Array.isArray(sp.q) ? sp.q.at(-1) : sp.q) ?? "";
  const q = parseQuery(raw);
  const empty = isEmptyQuery(q);

  // An empty query is not "match everything" — it is a question nobody asked, and
  // answering it would render the entire vault as a result set.
  const rows = empty ? [] : await search(q);
  const hits = rows.slice(0, LIMIT);

  const titles = await folderTitles(hits.map((h) => h.path));
  const ts = terms(q);
  // `is:trashed` switches the whole query, so either every hit is deleted or
  // none is. A deleted note has no page — the reader 404s it deliberately — so
  // these cards point at the room where it can be restored instead of at a link
  // that would look broken.
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

/**
 * One findMany, preceded by a folder lookup only when the query names a folder
 * by name.
 *
 * That lookup cannot live in `toPrismaWhere`: `in:graphs` names a folder
 * anywhere in the tree, resolving it is itself a query, and the compiler has no
 * client. Resolving to nothing is a real answer — the compiler turns an
 * unresolved scope into "match nothing" rather than widening a scoped search
 * back out to the whole vault, which would look like success.
 */
async function search(q: ParsedQuery) {
  const names = q.in.filter((f) => !f.startsWith("/"));
  // Live folders only. A trashed folder's path has been rewritten under a
  // tombstone, so it names a room nobody can be looking inside.
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
    // Path order lands every hit from one folder next to its neighbours, which
    // is the grouping the body renders — the rows arrive already gathered.
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

/**
 * Tag counts over the result set, which is what makes a facet worth clicking:
 * the number beside a tag is how many of *these* notes carry it, so the row
 * narrows as the query does. With nothing asked for there is no result set to
 * describe, and the honest stand-in is the vault's own tag list — the one moment
 * the extra read is free, since the search itself never ran.
 */
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

/**
 * A trashed row's path has been rewritten under its tombstone. `is:trashed` is a
 * search anyone can run, and grouping its hits under "~trash / 4f2c-…" names a
 * folder nobody has ever seen — the chain worth showing is the one the note came
 * from and will go back to.
 */
const home = (path: string) => untomb(path) || path;

/** Titles for every folder above every hit, in one query rather than one per
 *  card. The paths already name the ancestors; only their titles are missing. */
async function folderTitles(paths: string[]): Promise<Map<string, string>> {
  const above = [...new Set(paths.flatMap((p) => ancestorPaths(home(p)).slice(0, -1)))];
  if (!above.length) return new Map();
  const rows = await prisma.noteNode.findMany({
    where: { path: { in: above } },
    select: { path: true, title: true },
  });
  return new Map(rows.map((r) => [r.path, r.title]));
}

/** The folder chain a result sits in, which is the only thing distinguishing two
 *  questions that were named the same in different corners of the vault. */
function groupOf(path: string, titles: Map<string, string>): string {
  const chain = ancestorPaths(home(path)).slice(0, -1);
  if (!chain.length) return "the vault";
  return chain.map((p) => titles.get(p) ?? p.split("/").pop()!).join(" / ");
}
