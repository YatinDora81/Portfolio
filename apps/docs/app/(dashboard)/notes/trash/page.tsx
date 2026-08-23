import Link from "next/link";
import { prisma } from "db";
import { isOutermostTrashRoot, untomb } from "@/lib/notes/paths";
import type { TrashRow } from "@/lib/notes/view-types";
import { TrashList } from "../components/trash-list";

/** Restoring and purging both change this list out from under itself. */
export const dynamic = "force-dynamic";

export default async function TrashPage() {
  // Every soft-deleted row in one query, counted in memory afterwards.
  //
  // A prefix count over `path` would be counting the wrong thing: trashing
  // tombstones only the row that was explicitly trashed, and its descendants
  // keep the live paths they had, so they do not sit under their own root's
  // prefix. Structure comes from parentId here exactly as it does in the
  // actions.
  const rows = await prisma.noteNode.findMany({
    where: { NOT: { deletedAt: null } },
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      parentId: true,
      kind: true,
      title: true,
      slug: true,
      path: true,
      deletedAt: true,
      trashRoot: true,
    },
  });

  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId || r.parentId === r.id) continue;
    const list = childrenOf.get(r.parentId);
    if (list) list.push(r.id);
    else childrenOf.set(r.parentId, [r.id]);
  }
  const gone = new Set(rows.map((r) => r.id));

  // Guarded like `subtreeIds`: a parentId cycle has nothing else to stop it, and
  // an unguarded walk here grows the queue until the render OOMs the server.
  const countInside = (id: string) => {
    const seen = new Set([id]);
    const queue = [id];
    for (let i = 0; i < queue.length; i++) {
      for (const child of childrenOf.get(queue[i]!) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        queue.push(child);
      }
    }
    return queue.length - 1;
  };

  const trash: TrashRow[] = rows
    // `trashRoot` alone is the wrong predicate: trashing a folder never clears
    // the flag on a note already in the trash inside it, so filtering on it
    // lists that note a second time — beside the folder that already counts it
    // as "1 inside" — and offers a Restore that would pull it out of a folder
    // still in the trash. The sidebar badge uses this same rule.
    .filter(isOutermostTrashRoot)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      // A row whose parent is in the trash too — trash the note, then trash the
      // folder around it — does not go back where its tombstone remembers.
      // `restoreNode` reroots it rather than restore it into somewhere
      // unreachable, so this says where it will actually land.
      homePath: r.parentId && gone.has(r.parentId) ? `/${r.slug}` : untomb(r.path),
      inside: countInside(r.id),
      deletedAt: r.deletedAt!.toISOString(),
    }));

  // One wrapper, so `.nt-pane > *`'s centring applies to the column and not to
  // each line in it — the explanatory paragraph is capped well short of the
  // pane and would otherwise float out of line with the title above it.
  return (
    <div>
      <div className="nt-crumb">
        <Link href="/notes">Notes</Link>
        <span className="nt-crumb-sep">/</span>
        <b>Trash</b>
      </div>
      <h1 className="nt-title">Trash</h1>
      <p className="nt-blank-p">
        A trashed row gives its name back immediately: its path is parked under a tombstone, so a
        new folder can take the old name the same minute. Restoring lifts the tombstone and brings
        the whole subtree back to the path on its row.
      </p>
      <TrashList rows={trash} />
    </div>
  );
}
