import Link from "next/link";
import { prisma } from "db";
import { isOutermostTrashRoot, untomb } from "@/lib/notes/paths";
import type { TrashRow } from "@/lib/notes/view-types";
import { TrashList } from "../components/trash-list";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
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

  // a parentId cycle would otherwise never terminate
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
    .filter(isOutermostTrashRoot)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      homePath: r.parentId && gone.has(r.parentId) ? `/${r.slug}` : untomb(r.path),
      inside: countInside(r.id),
      deletedAt: r.deletedAt!.toISOString(),
    }));

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
