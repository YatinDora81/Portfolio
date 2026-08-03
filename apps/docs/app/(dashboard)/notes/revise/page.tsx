import Link from "next/link";
import { prisma } from "db";
import { hrefFor, type ReviseCard } from "@/lib/notes/view-types";
import { ReviseDeck } from "../components/revise-deck";

/** Every rating rewrites the ranking this page is, so a cached queue would deal
 *  the user cards they have already rated. */
export const dynamic = "force-dynamic";

/**
 * One sitting's worth, not the whole vault. The order stops being true the
 * moment the first card is rated, so a longer deck is only a longer stretch of
 * a ranking that has already gone stale — and the tail was going to be
 * recomputed on the next load anyway.
 */
const QUEUE_CAP = 60;

export default async function RevisePage() {
  const rows = await prisma.noteNode.findMany({
    where: { kind: "QUESTION", deletedAt: null },
    /**
     * The order is the whole idea: least confident first, and among equals the
     * ones never revised before anything already seen.
     *
     * The nulls-first form is checked against the generated client rather than
     * assumed — `lastRevisedAt` is nullable, so its slot in
     * `NoteAnswerOrderByWithRelationInput` is `SortOrderInput | SortOrder` and
     * Prisma 7 takes it inside a relation ordering. That keeps this one indexed
     * query instead of a sort in memory over a table that only grows.
     *
     * `path` breaks the remaining ties. Without a third key `take` slices an
     * arbitrary set out of the equally-ranked rows and the queue reshuffles
     * between loads for no reason; ordering by path also lands the run of
     * unrated cards from one folder together, which is how you actually revise.
     *
     * The single row this orders wrong is a QUESTION with no NoteAnswer at all:
     * the left join leaves its confidence NULL, Postgres sorts NULLs last on
     * ASC, and it goes to the back rather than the front. `createNode` writes
     * the answer row with the question, so only a row inserted around the app
     * can be in that state — and a question with no answer has nothing to
     * reveal.
     */
    orderBy: [
      { answer: { confidence: "asc" } },
      { answer: { lastRevisedAt: { sort: "asc", nulls: "first" } } },
      { path: "asc" },
    ],
    take: QUEUE_CAP,
    select: {
      id: true,
      title: true,
      path: true,
      parent: { select: { title: true } },
      answer: { select: { body: true, confidence: true } },
    },
  });

  const cards: ReviseCard[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    href: hrefFor(r.path),
    folder: r.parent?.title ?? "the vault",
    body: r.answer?.body ?? "",
    confidence: r.answer?.confidence ?? 0,
  }));

  // Nothing to deal, so nothing to hydrate: the deck's keyboard loop never ships
  // for a vault that has no questions in it yet.
  if (!cards.length) {
    return (
      <div className="nt-blank">
        <div className="nt-blank-h">Nothing to revise</div>
        <p className="nt-blank-p">
          A question joins this queue the moment it is written — unrated, and therefore first in
          line. Write one and it will be waiting here.
        </p>
        <div className="nt-blank-row">
          <Link className="btn" href="/notes">
            Open the vault
          </Link>
          <Link className="btn" href="/notes/search">
            Search
          </Link>
        </div>
      </div>
    );
  }

  return <ReviseDeck cards={cards} />;
}
