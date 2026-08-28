import { describe, expect, test } from "bun:test";
import { prisma } from "db";
import {
  NoteError,
  createIn,
  duplicateIn,
  importIn,
  moveIn,
  reorderIn,
  restoreIn,
  subtreeIds,
  trashIn,
  renameIn,
  type Tx,
} from "./core";
import { vaultJson, type ExportRow } from "./export";
import { parseImport, type VaultNode } from "./import";
import { TRASH_PREFIX, untomb } from "./paths";

const ROLLBACK = Symbol("rollback");

async function inRollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

const pathOf = async (tx: Tx, id: string) =>
  (await tx.noteNode.findUniqueOrThrow({ where: { id }, select: { path: true } })).path;

const rowOf = (tx: Tx, id: string) => tx.noteNode.findUniqueOrThrow({ where: { id } });

async function abc(tx: Tx) {
  const a = await createIn(tx, null, "FOLDER", "acc test a");
  const b = await createIn(tx, a.id, "FOLDER", "b");
  const c = await createIn(tx, b.id, "QUESTION", "c");
  return { a, b, c };
}

const live = !!process.env.DATABASE_URL;
if (!live) {
  console.warn("[notes] DATABASE_URL unset — skipping the notes integration suite");
}

describe.skipIf(!live)("notes · data integrity", () => {
  test("a folder rename rewrites every descendant path in the same transaction", async () => {
    await inRollback(async (tx) => {
      const { a, b, c } = await abc(tx);
      expect(await pathOf(tx, a.id)).toBe("/acc-test-a");
      expect(await pathOf(tx, b.id)).toBe("/acc-test-a/b");
      expect(await pathOf(tx, c.id)).toBe("/acc-test-a/b/c");

      await renameIn(tx, b.id, "b renamed");

      expect(await pathOf(tx, b.id)).toBe("/acc-test-a/b-renamed");
      expect(await pathOf(tx, c.id)).toBe("/acc-test-a/b-renamed/c");
    });
  });

  test("depth follows the move, for the node and everything under it", async () => {
    await inRollback(async (tx) => {
      const { a, b, c } = await abc(tx);
      const deep = await createIn(tx, null, "FOLDER", "acc test deep");
      const deeper = await createIn(tx, deep.id, "FOLDER", "x");

      expect((await rowOf(tx, b.id)).depth).toBe(1);
      expect((await rowOf(tx, c.id)).depth).toBe(2);

      await moveIn(tx, b.id, deeper.id);

      expect(await pathOf(tx, b.id)).toBe("/acc-test-deep/x/b");
      expect(await pathOf(tx, c.id)).toBe("/acc-test-deep/x/b/c");
      expect((await rowOf(tx, b.id)).depth).toBe(2);
      expect((await rowOf(tx, c.id)).depth).toBe(3);
      expect((await rowOf(tx, a.id)).depth).toBe(0);
    });
  });

  test("moving a folder into its own descendant is refused, with a message", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await abc(tx);
      await expect(moveIn(tx, a.id, b.id)).rejects.toThrow(NoteError);
      await expect(moveIn(tx, a.id, b.id)).rejects.toThrow(/own descendant/i);
      expect(await pathOf(tx, b.id)).toBe("/acc-test-a/b");
    });
  });

  test("a question can never be a destination", async () => {
    await inRollback(async (tx) => {
      const { b, c } = await abc(tx);
      await expect(moveIn(tx, b.id, c.id)).rejects.toThrow(/cannot hold children/i);
    });
  });

  test("a name that merely shares a prefix is not a descendant", async () => {
    await inRollback(async (tx) => {
      const one = await createIn(tx, null, "FOLDER", "acc dsa");
      const two = await createIn(tx, null, "FOLDER", "acc dsa two");
      await moveIn(tx, one.id, two.id);
      expect(await pathOf(tx, one.id)).toBe("/acc-dsa-two/acc-dsa");
    });
  });

  test("trash frees the live name immediately — the bug the tombstone exists for", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      const q = await createIn(tx, dp.id, "QUESTION", "inner");

      await trashIn(tx, dp.id);

      const trashed = await rowOf(tx, dp.id);
      expect(trashed.trashRoot).toBe(true);
      expect(trashed.deletedAt).not.toBeNull();
      expect(trashed.path.startsWith(TRASH_PREFIX)).toBe(true);
      expect(untomb(trashed.path)).toBe("/acc-dsa/dp");
      const inner = await rowOf(tx, q.id);
      expect(inner.deletedAt).not.toBeNull();
      expect(inner.path).toBe(`${trashed.path}/inner`);

      const again = await createIn(tx, dsa.id, "FOLDER", "dp");
      expect(again.path).toBe("/acc-dsa/dp");
    });
  });

  test("restore puts the subtree back at its original path, tombstone stripped", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      const q = await createIn(tx, dp.id, "QUESTION", "inner");

      await trashIn(tx, dp.id);
      await restoreIn(tx, dp.id);

      const back = await rowOf(tx, dp.id);
      expect(back.deletedAt).toBeNull();
      expect(back.trashRoot).toBe(false);
      expect(back.path).toBe("/acc-dsa/dp");
      expect(back.depth).toBe(1);

      const inner = await rowOf(tx, q.id);
      expect(inner.deletedAt).toBeNull();
      expect(inner.path).toBe("/acc-dsa/dp/inner");
      expect(inner.depth).toBe(2);
    });
  });

  test("restoring into a name that was taken meanwhile lands beside it, not on it", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      await trashIn(tx, dp.id);
      await createIn(tx, dsa.id, "FOLDER", "dp");

      await restoreIn(tx, dp.id);
      expect(await pathOf(tx, dp.id)).toBe("/acc-dsa/dp-2");
    });
  });

  test("a subtree holding an already-trashed node repaths correctly", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      const gone = await createIn(tx, dp.id, "QUESTION", "gone");

      await trashIn(tx, gone.id);
      const before = await rowOf(tx, gone.id);
      expect(untomb(before.path)).toBe("/acc-dsa/dp/gone");

      await renameIn(tx, dp.id, "dp renamed");

      const after = await rowOf(tx, gone.id);
      expect(untomb(after.path)).toBe("/acc-dsa/dp-renamed/gone");
      expect(after.trashRoot).toBe(true);
      expect(after.depth).toBe(2);
    });
  });

  test("a nested tombstone is absorbed by its ancestor's, and recovered on restore", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      const kept = await createIn(tx, dp.id, "QUESTION", "kept");
      const thrown = await createIn(tx, dp.id, "QUESTION", "thrown");

      await trashIn(tx, thrown.id);
      await trashIn(tx, dp.id);

      const outer = await rowOf(tx, dp.id);
      expect(untomb(outer.path)).toBe("/acc-dsa/dp");
      const inner = await rowOf(tx, thrown.id);
      expect(inner.path).toBe(`${outer.path}/thrown`);
      expect(inner.path.match(/~trash\//g)).toHaveLength(1);

      await restoreIn(tx, dp.id);

      expect((await rowOf(tx, dp.id)).path).toBe("/acc-dsa/dp");
      const back = await rowOf(tx, kept.id);
      expect(back.deletedAt).toBeNull();
      expect(back.path).toBe("/acc-dsa/dp/kept");

      const still = await rowOf(tx, thrown.id);
      expect(still.deletedAt).not.toBeNull();
      expect(still.trashRoot).toBe(true);
      expect(still.path).toBe(`${TRASH_PREFIX}${thrown.id}/acc-dsa/dp/thrown`);
    });
  });

  test("the whole trashed subtree frees its names, not just the row that was clicked", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      await createIn(tx, dp.id, "QUESTION", "inner");

      await trashIn(tx, dp.id);

      const again = await createIn(tx, dsa.id, "FOLDER", "dp");
      const innerAgain = await createIn(tx, again.id, "QUESTION", "inner");
      expect(again.path).toBe("/acc-dsa/dp");
      expect(innerAgain.path).toBe("/acc-dsa/dp/inner");
    });
  });

  test("restoring into a trashed parent lands at the root rather than nowhere", async () => {
    await inRollback(async (tx) => {
      const dsa = await createIn(tx, null, "FOLDER", "acc dsa");
      const dp = await createIn(tx, dsa.id, "FOLDER", "dp");
      await trashIn(tx, dp.id);
      await trashIn(tx, dsa.id);

      await restoreIn(tx, dp.id);
      const back = await rowOf(tx, dp.id);
      expect(back.parentId).toBeNull();
      expect(back.path).toBe("/dp");
      expect(back.depth).toBe(0);
    });
  });

  test("purge cascades to descendants and their answers", async () => {
    await inRollback(async (tx) => {
      const { a, b, c } = await abc(tx);
      expect(await tx.noteAnswer.count({ where: { nodeId: c.id } })).toBe(1);

      await tx.noteNode.delete({ where: { id: a.id } });

      expect(await tx.noteNode.count({ where: { id: { in: [a.id, b.id, c.id] } } })).toBe(0);
      expect(await tx.noteAnswer.count({ where: { nodeId: c.id } })).toBe(0);
    });
  });

  test("two siblings with the same name get -2, and every live path stays unique", async () => {
    await inRollback(async (tx) => {
      const p = await createIn(tx, null, "FOLDER", "acc dupes");
      const one = await createIn(tx, p.id, "FOLDER", "dp");
      const two = await createIn(tx, p.id, "FOLDER", "dp");
      const three = await createIn(tx, p.id, "FOLDER", "dp");
      expect([one.path, two.path, three.path]).toEqual([
        "/acc-dupes/dp",
        "/acc-dupes/dp-2",
        "/acc-dupes/dp-3",
      ]);
      expect(new Set([one.path, two.path, three.path]).size).toBe(3);
    });
  });

  test("two root folders cannot share a name — what path @unique is really for", async () => {
    await inRollback(async (tx) => {
      const one = await createIn(tx, null, "FOLDER", "acc root clash");
      const two = await createIn(tx, null, "FOLDER", "acc root clash");
      expect(one.path).toBe("/acc-root-clash");
      expect(two.path).toBe("/acc-root-clash-2");
    });
  });

  test("a root folder cannot occupy a route the section already owns", async () => {
    await inRollback(async (tx) => {
      for (const reserved of ["search", "revise", "trash", "export"]) {
        const n = await createIn(tx, null, "FOLDER", reserved);
        expect(n.path).toBe(`/${reserved}-2`);
      }
    });
  });

  test("a move reindexes sortOrder on both the old parent and the new one", async () => {
    await inRollback(async (tx) => {
      const from = await createIn(tx, null, "FOLDER", "acc from");
      const to = await createIn(tx, null, "FOLDER", "acc to");
      const x = await createIn(tx, from.id, "QUESTION", "x");
      const y = await createIn(tx, from.id, "QUESTION", "y");
      const z = await createIn(tx, from.id, "QUESTION", "z");
      await createIn(tx, to.id, "QUESTION", "already");

      await moveIn(tx, y.id, to.id, 0);

      const left = await tx.noteNode.findMany({
        where: { parentId: from.id, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true },
      });
      expect(left.map((r) => r.sortOrder)).toEqual([0, 1]);
      expect(left.map((r) => r.id)).toEqual([x.id, z.id]);

      const arrived = await tx.noteNode.findMany({
        where: { parentId: to.id, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true },
      });
      expect(arrived.map((r) => r.sortOrder)).toEqual([0, 1]);
      expect(arrived[0]!.id).toBe(y.id);
    });
  });

  test("trashing reindexes the level it left", async () => {
    await inRollback(async (tx) => {
      const p = await createIn(tx, null, "FOLDER", "acc reindex");
      const x = await createIn(tx, p.id, "QUESTION", "x");
      await createIn(tx, p.id, "QUESTION", "y");
      const z = await createIn(tx, p.id, "QUESTION", "z");

      await trashIn(tx, x.id);

      const left = await tx.noteNode.findMany({
        where: { parentId: p.id, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true },
      });
      expect(left.map((r) => r.sortOrder)).toEqual([0, 1]);
      expect(left[1]!.id).toBe(z.id);
    });
  });

  test("reorder only renumbers rows that really are children of that parent", async () => {
    await inRollback(async (tx) => {
      const mine = await createIn(tx, null, "FOLDER", "acc mine");
      const theirs = await createIn(tx, null, "FOLDER", "acc theirs");
      const a = await createIn(tx, mine.id, "QUESTION", "a");
      const b = await createIn(tx, mine.id, "QUESTION", "b");
      const outsider = await createIn(tx, theirs.id, "QUESTION", "outsider");
      const before = (await rowOf(tx, outsider.id)).sortOrder;

      await reorderIn(tx, mine.id, [b.id, a.id, outsider.id]);

      expect((await rowOf(tx, b.id)).sortOrder).toBe(0);
      expect((await rowOf(tx, a.id)).sortOrder).toBe(1);
      expect((await rowOf(tx, outsider.id)).sortOrder).toBe(before);
      expect((await rowOf(tx, outsider.id)).parentId).toBe(theirs.id);
    });
  });

  test("duplicate copies the subtree, its answers, and nothing else", async () => {
    await inRollback(async (tx) => {
      const p = await createIn(tx, null, "FOLDER", "acc dup");
      const q = await createIn(tx, p.id, "QUESTION", "inner");
      await tx.noteAnswer.update({
        where: { nodeId: q.id },
        data: { body: "the body", tags: ["one", "two"], confidence: 3 },
      });

      const copy = await duplicateIn(tx, p.id);
      expect(copy.path).toBe("/acc-dup-copy");

      const kids = await tx.noteNode.findMany({
        where: { parentId: copy.id },
        include: { answer: true },
      });
      expect(kids).toHaveLength(1);
      expect(kids[0]!.path).toBe("/acc-dup-copy/inner");
      expect(kids[0]!.answer?.body).toBe("the body");
      expect(kids[0]!.answer?.tags).toEqual(["one", "two"]);
      expect(kids[0]!.answer?.confidence).toBe(3);
      expect((await rowOf(tx, q.id)).path).toBe("/acc-dup/inner");
    });
  });

  test("a question cannot be given children", async () => {
    await inRollback(async (tx) => {
      const q = await createIn(tx, null, "QUESTION", "acc lonely");
      await expect(createIn(tx, q.id, "QUESTION", "child")).rejects.toThrow(/only folders/i);
    });
  });

  test("an empty title is refused before anything is written", async () => {
    await inRollback(async (tx) => {
      const before = await tx.noteNode.count();
      await expect(createIn(tx, null, "FOLDER", "   ")).rejects.toThrow(/title required/i);
      expect(await tx.noteNode.count()).toBe(before);
    });
  });
});

async function exportOf(tx: Tx, rootId: string): Promise<VaultNode[]> {
  const ids = await subtreeIds(tx, rootId);
  const rows = await tx.noteNode.findMany({ where: { id: { in: ids } }, include: { answer: true } });
  const shaped: ExportRow[] = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    kind: r.kind,
    title: r.title,
    slug: r.slug,
    path: r.path,
    depth: r.depth,
    sortOrder: r.sortOrder,
    answer: r.answer
      ? {
          body: r.answer.body,
          tags: r.answer.tags,
          confidence: r.answer.confidence,
          lastRevisedAt: r.answer.lastRevisedAt?.toISOString() ?? null,
        }
      : null,
  }));
  return parsed(JSON.parse(vaultJson(shaped)));
}

function parsed(raw: unknown): VaultNode[] {
  const r = parseImport(raw);
  if (!r.ok) throw new Error(`the file was refused: ${r.error}`);
  return r.nodes;
}

const kidsOf = (tx: Tx, id: string) =>
  tx.noteNode.findMany({
    where: { parentId: id, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

describe.skipIf(!live)("notes · import", () => {
  test("a folder export lands intact inside another folder", async () => {
    await inRollback(async (tx) => {
      const home = await createIn(tx, null, "FOLDER", "acc imp home");
      const src = await createIn(tx, home.id, "FOLDER", "src");
      const graphs = await createIn(tx, src.id, "FOLDER", "graphs");
      const q = await createIn(tx, graphs.id, "QUESTION", "bridges");
      await tx.noteAnswer.update({
        where: { nodeId: q.id },
        data: { body: "a bridge is an edge whose removal disconnects", tags: ["graphs"], confidence: 3 },
      });
      const dest = await createIn(tx, null, "FOLDER", "acc imp dest");

      const file = await exportOf(tx, src.id);
      const r = await importIn(tx, dest.id, file, "into");

      expect(r.created).toBe(3);
      expect(r.rootIds).toHaveLength(1);

      const landed = await rowOf(tx, r.rootIds[0]!);
      expect(landed.path).toBe("/acc-imp-dest/src");
      expect(landed.depth).toBe(1);
      expect(landed.parentId).toBe(dest.id);

      const inner = await tx.noteNode.findMany({
        where: { path: { startsWith: "/acc-imp-dest/" } },
        orderBy: { path: "asc" },
        include: { answer: true },
      });
      expect(inner.map((n) => n.path)).toEqual([
        "/acc-imp-dest/src",
        "/acc-imp-dest/src/graphs",
        "/acc-imp-dest/src/graphs/bridges",
      ]);
      expect(inner.map((n) => n.depth)).toEqual([1, 2, 3]);

      const copy = inner.find((n) => n.kind === "QUESTION")!;
      expect(copy.answer?.body).toBe("a bridge is an edge whose removal disconnects");
      expect(copy.answer?.tags).toEqual(["graphs"]);
      expect(copy.answer?.confidence).toBe(3);
      expect(inner.filter((n) => n.kind === "FOLDER").every((n) => n.answer === null)).toBe(true);

      expect(await pathOf(tx, src.id)).toBe("/acc-imp-home/src");
    });
  });

  test("importing an export back where it came from lands beside it, never on it", async () => {
    await inRollback(async (tx) => {
      const home = await createIn(tx, null, "FOLDER", "acc imp home");
      const dsa = await createIn(tx, home.id, "FOLDER", "dsa");
      await createIn(tx, dsa.id, "QUESTION", "inner");

      const file = await exportOf(tx, dsa.id);
      const r = await importIn(tx, home.id, file, "into");

      expect(await pathOf(tx, r.rootIds[0]!)).toBe("/acc-imp-home/dsa-2");
      expect((await kidsOf(tx, r.rootIds[0]!)).map((k) => k.path)).toEqual(["/acc-imp-home/dsa-2/inner"]);
      expect(await pathOf(tx, dsa.id)).toBe("/acc-imp-home/dsa");
      expect(await tx.noteNode.count({ where: { parentId: home.id, deletedAt: null } })).toBe(2);
    });
  });

  test("ids are reissued, so an import can never overwrite what it was copied from", async () => {
    await inRollback(async (tx) => {
      const home = await createIn(tx, null, "FOLDER", "acc imp home");
      const one = await createIn(tx, home.id, "QUESTION", "only");
      const file = await exportOf(tx, one.id);

      const r = await importIn(tx, home.id, file, "into");
      expect(r.rootIds[0]).not.toBe(one.id);
      expect(await tx.noteNode.count({ where: { id: one.id } })).toBe(1);
    });
  });

  test("a nested outline four levels deep arrives with its parentId chain intact", async () => {
    await inRollback(async (tx) => {
      const dest = await createIn(tx, null, "FOLDER", "acc imp nested");
      const nodes = parsed([
        {
          title: "DSA",
          children: [
            {
              title: "Graphs",
              children: [
                { title: "Shortest path", children: ["Dijkstra vs Bellman-Ford", "When is BFS enough?"] },
              ],
            },
            { title: "Dynamic Programming", children: [] },
          ],
        },
      ]);

      await importIn(tx, dest.id, nodes, "into");

      const rows = await tx.noteNode.findMany({
        where: { path: { startsWith: "/acc-imp-nested/" } },
        orderBy: { path: "asc" },
        include: { answer: true },
      });
      expect(rows.map((n) => `${n.path} · ${n.depth} · ${n.kind}`)).toEqual([
        "/acc-imp-nested/dsa · 1 · FOLDER",
        "/acc-imp-nested/dsa/dynamic-programming · 2 · FOLDER",
        "/acc-imp-nested/dsa/graphs · 2 · FOLDER",
        "/acc-imp-nested/dsa/graphs/shortest-path · 3 · FOLDER",
        "/acc-imp-nested/dsa/graphs/shortest-path/dijkstra-vs-bellman-ford · 4 · QUESTION",
        "/acc-imp-nested/dsa/graphs/shortest-path/when-is-bfs-enough · 4 · QUESTION",
      ]);

      const dp = rows.find((n) => n.slug === "dynamic-programming")!;
      expect(dp.kind).toBe("FOLDER");
      expect(dp.answer).toBeNull();

      const bfs = rows.find((n) => n.slug === "when-is-bfs-enough")!;
      expect(bfs.answer?.body).toBe("");
      expect(bfs.answer?.confidence).toBe(0);

      for (const n of rows) expect(n.answer === null).toBe(n.kind === "FOLDER");

      const parentOf = new Map(rows.map((n) => [n.slug, n.parentId]));
      expect(parentOf.get("dijkstra-vs-bellman-ford")).toBe(rows.find((n) => n.slug === "shortest-path")!.id);
    });
  });

  test("two sibling folders with the same title both arrive, each keeping its own children", async () => {
    await inRollback(async (tx) => {
      const dest = await createIn(tx, null, "FOLDER", "acc imp dupes");
      await createIn(tx, dest.id, "FOLDER", "graphs");

      await importIn(
        tx,
        dest.id,
        parsed([
          { title: "Graphs", children: ["What is a bridge?"] },
          { title: "Graphs", children: ["duplicate on purpose"] },
        ]),
        "into",
      );

      const rows = await tx.noteNode.findMany({
        where: { path: { startsWith: "/acc-imp-dupes/" } },
        orderBy: { path: "asc" },
      });
      expect(rows.map((n) => n.path)).toEqual([
        "/acc-imp-dupes/graphs",
        "/acc-imp-dupes/graphs-2",
        "/acc-imp-dupes/graphs-2/what-is-a-bridge",
        "/acc-imp-dupes/graphs-3",
        "/acc-imp-dupes/graphs-3/duplicate-on-purpose",
      ]);
      expect(new Set(rows.map((n) => n.path)).size).toBe(rows.length);
    });
  });

  test("a root folder cannot occupy a route the section already owns", async () => {
    await inRollback(async (tx) => {
      const r = await importIn(tx, null, parsed([{ title: "Export", children: [] }]), "into");
      expect(await pathOf(tx, r.rootIds[0]!)).toBe("/export-2");
    });
  });

  test("path and depth come from the tree, never from the file", async () => {
    await inRollback(async (tx) => {
      const dest = await createIn(tx, null, "FOLDER", "acc imp lies");
      const nodes = parsed({
        format: "yatindora.notes.vault",
        version: 1,
        count: 2,
        nodes: [
          {
            id: "liar-1",
            parentId: null,
            kind: "FOLDER",
            title: "Truthful title",
            slug: "somewhere-else",
            path: "/not/where/this/lands",
            depth: 41,
            sortOrder: 0,
            body: "",
            tags: [],
            confidence: 0,
            lastRevisedAt: null,
          },
          {
            id: "liar-2",
            parentId: "liar-1",
            kind: "QUESTION",
            title: "Child",
            slug: "lies-too",
            path: "/nowhere",
            depth: 99,
            sortOrder: 0,
            body: "kept",
            tags: ["kept"],
            confidence: 4,
            lastRevisedAt: "2026-07-19T11:02:00.000Z",
          },
        ],
      });

      await importIn(tx, dest.id, nodes, "into");

      const rows = await tx.noteNode.findMany({
        where: { path: { startsWith: "/acc-imp-lies/" } },
        orderBy: { path: "asc" },
        include: { answer: true },
      });
      expect(rows.map((n) => [n.path, n.depth, n.slug])).toEqual([
        ["/acc-imp-lies/truthful-title", 1, "truthful-title"],
        ["/acc-imp-lies/truthful-title/child", 2, "child"],
      ]);
      expect(rows[1]!.answer?.body).toBe("kept");
      expect(rows[1]!.answer?.tags).toEqual(["kept"]);
      expect(rows[1]!.answer?.confidence).toBe(4);
      expect(rows[1]!.answer?.lastRevisedAt?.toISOString()).toBe("2026-07-19T11:02:00.000Z");
      expect(await tx.noteNode.count({ where: { id: { in: ["liar-1", "liar-2"] } } })).toBe(0);
    });
  });

  test("a file whose folders loop is refused before a single row is written", async () => {
    await inRollback(async (tx) => {
      const before = await tx.noteNode.count();
      const cyclic: VaultNode[] = [
        { id: "a", parentId: "b", kind: "FOLDER", title: "A", body: "", tags: [], confidence: 0, lastRevisedAt: null },
        { id: "b", parentId: "a", kind: "FOLDER", title: "B", body: "", tags: [], confidence: 0, lastRevisedAt: null },
      ];
      await expect(importIn(tx, null, cyclic, "into")).rejects.toThrow(NoteError);
      expect(await tx.noteNode.count()).toBe(before);
    });
  });

  test("a folder carrying an answer body is refused, and nothing is written", async () => {
    await inRollback(async (tx) => {
      const before = await tx.noteNode.count();
      await expect(
        importIn(tx, null, parsed([{ title: "acc imp bad", kind: "FOLDER" }]).map((n) => ({ ...n, body: "nope" })), "into"),
      ).rejects.toThrow(/can't hold an answer/i);
      expect(await tx.noteNode.count()).toBe(before);
    });
  });

  test("a destination that is a question, or in the trash, is refused like any other write", async () => {
    await inRollback(async (tx) => {
      const q = await createIn(tx, null, "QUESTION", "acc imp lonely");
      const nodes = parsed([{ title: "anything" }]);
      await expect(importIn(tx, q.id, nodes, "into")).rejects.toThrow(/only folders/i);

      const gone = await createIn(tx, null, "FOLDER", "acc imp gone");
      await trashIn(tx, gone.id);
      await expect(importIn(tx, gone.id, nodes, "into")).rejects.toThrow(/in the trash/i);

      await expect(importIn(tx, "no-such-folder", nodes, "into")).rejects.toThrow(/no longer exists/i);
    });
  });

  test("restore refuses a vault that already holds anything", async () => {
    await inRollback(async (tx) => {
      await createIn(tx, null, "FOLDER", "acc imp occupied");
      const before = await tx.noteNode.count();
      await expect(importIn(tx, null, parsed([{ title: "x" }]), "restore")).rejects.toThrow(/empty vault/i);
      const somewhere = await createIn(tx, null, "FOLDER", "acc imp anywhere");
      await expect(importIn(tx, somewhere.id, parsed([{ title: "x" }]), "restore")).rejects.toThrow(/can't be aimed/i);
      expect(await tx.noteNode.count()).toBe(before + 1);
    });
  });

  test("a thousand nodes go in as one graft, dense and correctly ordered", async () => {
    await inRollback(async (tx) => {
      const dest = await createIn(tx, null, "FOLDER", "acc imp big");
      // 10 folders of 99 questions each, plus the folders themselves.
      const outline = Array.from({ length: 10 }, (_, f) => ({
        title: `Folder ${f}`,
        children: Array.from({ length: 99 }, (_, q) => `Question ${f}-${q}`),
      }));
      const nodes = parsed(outline);
      expect(nodes).toHaveLength(1_000);

      const r = await importIn(tx, dest.id, nodes, "into");
      expect(r.created).toBe(1_000);
      expect(r.rootIds).toHaveLength(10);

      const roots = await kidsOf(tx, dest.id);
      expect(roots.map((n) => n.sortOrder)).toEqual([...Array(10).keys()]);
      expect(roots.map((n) => n.title)).toEqual(outline.map((o) => o.title));

      const inside = await kidsOf(tx, roots[3]!.id);
      expect(inside).toHaveLength(99);
      expect(inside.map((n) => n.sortOrder)).toEqual([...Array(99).keys()]);
      expect(inside[0]!.path).toBe("/acc-imp-big/folder-3/question-3-0");
      expect(inside[0]!.depth).toBe(2);
      expect(await tx.noteAnswer.count({ where: { nodeId: { in: inside.map((n) => n.id) } } })).toBe(99);
    });
  }, 60_000);
});

describe.skipIf(!live)("notes · the suite left nothing behind", () => {
  test("no acceptance rows survived the rollbacks", async () => {
    const strays = await prisma.noteNode.count({ where: { title: { startsWith: "acc " } } });
    expect(strays).toBe(0);
  });
});
