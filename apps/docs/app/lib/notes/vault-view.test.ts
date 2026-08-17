import { describe, expect, test } from "bun:test";
import {
  childRowsIn,
  crumbsIn,
  folderStatsIn,
  folderViewIn,
  indexVault,
  parentTitleIn,
  questionViewIn,
  siblingsIn,
  type VaultAnswer,
  type VaultPayload,
  type VaultRow,
} from "./vault-view";

/**
 * These functions replaced six SQL queries, and the queries were the spec.
 * Each block below pins one of the guarantees Postgres used to make, so that
 * "the numbers moved" is a failing test rather than something noticed a month
 * later on a folder overview.
 *
 * The subtle one is `below`: `folderStats` counted descendants by PATH PREFIX
 * and the sidebar badge counted them by parentage. One pass answers both now,
 * and it has to keep answering the prefix question — including for a row whose
 * parent is missing, which `buildTree` promotes to a root but whose path still
 * names the folder it belongs to.
 */

let n = 0;
const ans = (a: Partial<VaultAnswer> = {}): VaultAnswer => ({
  body: "",
  tags: [],
  confidence: 0,
  lastRevisedAt: null,
  ...a,
});

const folder = (path: string, extra: Partial<VaultRow> = {}): VaultRow => ({
  id: `f${++n}`,
  parentId: null,
  kind: "FOLDER",
  title: path.split("/").pop()!,
  slug: path.split("/").pop()!,
  path,
  depth: path.split("/").length - 1,
  sortOrder: 0,
  answer: null,
  ...extra,
});

const question = (path: string, extra: Partial<VaultRow> = {}): VaultRow => ({
  ...folder(path, extra),
  kind: "QUESTION",
  answer: ans(),
  ...extra,
});

/** Wires parentId from the paths, the way the database always has. */
const vault = (rows: VaultRow[], trashCount = 0): VaultPayload => {
  const byPath = new Map(rows.map((r) => [r.path, r]));
  return {
    rows: rows.map((r) => {
      const parent = byPath.get(r.path.slice(0, r.path.lastIndexOf("/")));
      return { ...r, parentId: parent?.id ?? r.parentId };
    }),
    trashCount,
    vaultEmpty: rows.length === 0 && trashCount === 0,
  };
};

const DSA = [
  folder("/dsa"),
  folder("/dsa/graphs"),
  question("/dsa/graphs/bfs", { answer: ans({ confidence: 4, tags: ["graphs"] }) }),
  question("/dsa/graphs/dfs", { answer: ans({ confidence: 1 }) }),
  folder("/dsa/graphs/shortest"),
  question("/dsa/graphs/shortest/dijkstra", { answer: ans({ confidence: 3 }) }),
  question("/dsa/dp", { answer: ans({ confidence: 0 }) }),
  folder("/redis"),
];

describe("folderStatsIn", () => {
  const ix = indexVault(vault(DSA));

  test("counts the whole subtree by path prefix, not the level below", () => {
    // /dsa holds graphs + shortest, and four questions across three levels.
    expect(folderStatsIn(ix, "/dsa")).toEqual({ questions: 4, folders: 2, solidPct: 50 });
  });

  test("solid is confidence >= 3, rounded", () => {
    // bfs(4) and dijkstra(3) of four questions.
    expect(folderStatsIn(ix, "/dsa").solidPct).toBe(50);
    // graphs: bfs(4), dfs(1), dijkstra(3) — two of three.
    expect(folderStatsIn(ix, "/dsa/graphs").solidPct).toBe(67);
  });

  test("an empty folder is zero, never a division by zero", () => {
    expect(folderStatsIn(ix, "/redis")).toEqual({ questions: 0, folders: 0, solidPct: 0 });
  });

  test("a sibling whose name is a prefix is not a descendant", () => {
    const ix2 = indexVault(vault([folder("/dsa"), question("/dsa/x"), folder("/dsa-archive"), question("/dsa-archive/y")]));
    expect(folderStatsIn(ix2, "/dsa").questions).toBe(1);
  });
});

describe("childRowsIn", () => {
  const ix = indexVault(vault(DSA));

  test("a folder's meta is the questions beneath it, a question's is its rating", () => {
    const rows = childRowsIn(ix, ix.byPath.get("/dsa/graphs")!);
    expect(rows.map((r) => [r.title, r.meta])).toEqual([
      ["bfs", "solid"],
      ["dfs", "again"],
      ["shortest", "1 q"],
    ]);
  });

  test("a question with no answer row reads as unrated, not as a crash", () => {
    const ix2 = indexVault(vault([folder("/f"), { ...question("/f/q"), answer: null }]));
    expect(childRowsIn(ix2, ix2.byPath.get("/f")!)[0]!.meta).toBe("unrated");
  });

  test("hrefs are the note's own path under /notes", () => {
    expect(childRowsIn(ix, ix.byPath.get("/dsa/graphs")!)[0]!.href).toBe("/notes/dsa/graphs/bfs");
  });
});

describe("siblingsIn", () => {
  test("questions only, self excluded, capped at twelve", () => {
    const many = [folder("/f"), ...Array.from({ length: 20 }, (_, i) => question(`/f/q${i}`)), folder("/f/sub")];
    const ix = indexVault(vault(many));
    const sibs = siblingsIn(ix, ix.byPath.get("/f/q0")!);
    expect(sibs).toHaveLength(12);
    expect(sibs.some((s) => s.href === "/notes/f/q0")).toBe(false);
    expect(sibs.some((s) => s.href === "/notes/f/sub")).toBe(false);
  });

  test("a question at the vault root sees the other root questions", () => {
    const ix = indexVault(vault([question("/a"), question("/b"), folder("/c")]));
    expect(siblingsIn(ix, ix.byPath.get("/a")!).map((s) => s.title)).toEqual(["b"]);
  });
});

describe("crumbsIn", () => {
  const ix = indexVault(vault(DSA));

  test("one crumb per segment, titles read off the rows", () => {
    expect(crumbsIn(ix, "/dsa/graphs/bfs")).toEqual([
      { title: "dsa", href: "/notes/dsa" },
      { title: "graphs", href: "/notes/dsa/graphs" },
      { title: "bfs", href: "/notes/dsa/graphs/bfs" },
    ]);
  });

  test("a missing ancestor falls back to its slug rather than vanishing", () => {
    expect(crumbsIn(ix, "/ghost/child").map((c) => c.title)).toEqual(["ghost", "child"]);
  });

  test("parentTitleIn names the folder you are standing in, or the vault", () => {
    expect(parentTitleIn(crumbsIn(ix, "/dsa/graphs/bfs"))).toBe("graphs");
    expect(parentTitleIn(crumbsIn(ix, "/dsa"))).toBe("the vault");
  });
});

describe("indexVault", () => {
  test("an orphan becomes a root but still counts toward the path above it", () => {
    // No /gone row: buildTree promotes the child, and the prefix count is what
    // the old `folderStats` query would still have returned.
    const ix = indexVault(vault([question("/gone/kept", { parentId: "missing" })]));
    expect(ix.tree.map((t) => t.path)).toEqual(["/gone/kept"]);
    expect(folderStatsIn(ix, "/gone")).toEqual({ questions: 1, folders: 0, solidPct: 0 });
  });

  test("sibling order is the tree's, ties broken on id", () => {
    const rows = vault([
      folder("/f"),
      { ...question("/f/b"), id: "z", sortOrder: 1 },
      { ...question("/f/a"), id: "a", sortOrder: 1 },
      { ...question("/f/c"), id: "m", sortOrder: 0 },
    ]);
    const ix = indexVault(rows);
    expect(childRowsIn(ix, ix.byPath.get("/f")!).map((r) => r.title)).toEqual(["c", "a", "b"]);
  });

  test("questions counts roll up the tree", () => {
    const ix = indexVault(vault(DSA));
    const dsa = ix.tree.find((t) => t.path === "/dsa")!;
    expect(dsa.questions).toBe(4);
    expect(dsa.children.find((c) => c.path === "/dsa/graphs")!.questions).toBe(3);
  });

  test("an orphan's sibling strip is empty, the way the query it replaced left it", () => {
    // Pinned rather than fixed: `buildTree` promotes the row to a root, `below`
    // still counts it under its path's ancestors, but `kids` never files it under
    // a parent that is not there — and `parentId: <missing>` matched nothing in
    // the SQL either. A later tidy in either direction should have to argue with
    // this test first.
    const ix = indexVault(vault([question("/gone/kept", { parentId: "missing" })]));
    const row = ix.byPath.get("/gone/kept")!;
    expect(siblingsIn(ix, row)).toEqual([]);
    expect(ix.tree.map((t) => t.path)).toEqual(["/gone/kept"]);
  });

  test("an empty vault indexes to nothing rather than throwing", () => {
    const ix = indexVault(vault([]));
    expect(ix.tree).toEqual([]);
    expect(ix.vaultEmpty).toBe(true);
    expect(folderStatsIn(ix, "/anything")).toEqual({ questions: 0, folders: 0, solidPct: 0 });
  });
});

describe("the views the pane renders", () => {
  const ix = indexVault(vault(DSA));

  test("questionViewIn carries the answer, defaulted when there is no row", () => {
    const v = questionViewIn(ix, ix.byPath.get("/dsa/graphs/bfs")!);
    expect(v.href).toBe("/notes/dsa/graphs/bfs");
    expect(v.answer).toEqual({ body: "", tags: ["graphs"], confidence: 4, lastRevisedAt: null });
    expect(v.crumbs).toHaveLength(3);
  });

  test("folderViewIn is the crumbs, the level below and the three numbers", () => {
    const v = folderViewIn(ix, ix.byPath.get("/dsa/graphs")!);
    expect(v.children.map((c) => c.title)).toEqual(["bfs", "dfs", "shortest"]);
    expect(v.stats).toEqual({ questions: 3, folders: 1, solidPct: 67 });
  });
});

describe("the ratings overlay", () => {
  const base = vault(DSA);

  test("a rating reaches every number derived from it, in one pass", () => {
    const dfs = base.rows.find((r) => r.path === "/dsa/graphs/dfs")!;
    const before = indexVault(base);
    expect(before.byPath.get("/dsa/graphs/dfs")!.answer!.confidence).toBe(1);
    expect(folderStatsIn(before, "/dsa/graphs").solidPct).toBe(67);

    const after = indexVault(base, new Map([[dfs.id, 4]]));
    // The note itself, the folder percentage and the row's own label — one
    // number, three readers, no chance of them disagreeing.
    expect(questionViewIn(after, after.byPath.get("/dsa/graphs/dfs")!).answer.confidence).toBe(4);
    expect(folderStatsIn(after, "/dsa/graphs").solidPct).toBe(100);
    expect(
      childRowsIn(after, after.byPath.get("/dsa/graphs")!).find((c) => c.title === "dfs")!.meta
    ).toBe("solid");
  });

  test("the payload it was applied to is not mutated", () => {
    const dfs = base.rows.find((r) => r.path === "/dsa/graphs/dfs")!;
    indexVault(base, new Map([[dfs.id, 4]]));
    expect(dfs.answer!.confidence).toBe(1);
  });

  test("an id the vault does not hold is ignored, not thrown over", () => {
    const ix = indexVault(base, new Map([["not-a-row", 4]]));
    expect(folderStatsIn(ix, "/dsa")).toEqual(folderStatsIn(indexVault(base), "/dsa"));
  });

  test("an empty overlay is the same index as none at all", () => {
    expect(indexVault(base, new Map()).rows).toBe(base.rows);
  });
});
