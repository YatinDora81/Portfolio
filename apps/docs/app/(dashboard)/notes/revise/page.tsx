import Link from "next/link";
import { prisma } from "db";
import { hrefFor, type ReviseCard } from "@/lib/notes/view-types";
import { ReviseDeck } from "../components/revise-deck";

export const dynamic = "force-dynamic";

const QUEUE_CAP = 60;

export default async function RevisePage() {
  const rows = await prisma.noteNode.findMany({
    where: { kind: "QUESTION", deletedAt: null },
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
