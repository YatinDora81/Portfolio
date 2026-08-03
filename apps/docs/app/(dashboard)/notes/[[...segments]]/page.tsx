import { notFound } from "next/navigation";
import { prisma } from "db";
import { childRows, crumbsFor, folderStats, titleByPath } from "@/lib/notes/load";
import { hrefFor } from "@/lib/notes/view-types";
import { AnswerView } from "../components/answer-view";
import { FolderOverview } from "../components/folder-overview";
import { NotesBlank } from "../components/notes-blank";

/** The vault moves under the user's own hands; a cached render would show them
 *  a tree they have already changed. */
export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments } = await params;
  // Counted rather than inferred from the tree: `restore` refuses a vault that
  // holds anything at all, trashed rows included, and the tree only knows about
  // live ones.
  if (!segments?.length) return <NotesBlank vaultEmpty={(await prisma.noteNode.count()) === 0} />;

  // One indexed lookup on the unique path column. The URL under /notes IS the
  // note's path, so resolving a deep link costs exactly one query no matter how
  // deep it is — no walk down from the root, no join per level.
  const path = `/${segments.map(decodeURIComponent).join("/")}`;
  const node = await prisma.noteNode.findUnique({
    where: { path },
    include: { answer: true },
  });
  if (!node || node.deletedAt) notFound();

  const titles = await titleByPath(path);
  const crumbs = crumbsFor(path, titles);

  if (node.kind === "FOLDER") {
    const [children, stats] = await Promise.all([childRows(node.id), folderStats(path)]);
    return (
      <FolderOverview
        node={{ id: node.id, title: node.title, path, href: hrefFor(path), crumbs, children, stats }}
      />
    );
  }

  const siblings = await prisma.noteNode.findMany({
    where: { parentId: node.parentId, kind: "QUESTION", deletedAt: null, NOT: { id: node.id } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, title: true, path: true },
    take: 12,
  });

  return (
    <AnswerView
      node={{
        id: node.id,
        title: node.title,
        path,
        href: hrefFor(path),
        crumbs,
        answer: {
          body: node.answer?.body ?? "",
          tags: node.answer?.tags ?? [],
          confidence: node.answer?.confidence ?? 0,
          lastRevisedAt: node.answer?.lastRevisedAt?.toISOString() ?? null,
        },
      }}
      siblings={siblings.map((s) => ({ id: s.id, title: s.title, href: hrefFor(s.path) }))}
      parentTitle={crumbs.length > 1 ? crumbs[crumbs.length - 2]!.title : "the vault"}
    />
  );
}
