import { describe, expect, test } from "bun:test";
import {
  MAX_DEPTH,
  MAX_NODES,
  detectShape,
  fileRoots,
  flattenNested,
  levelOrder,
  parseImport,
  planGraft,
  summarise,
  topoOrder,
  vaultProblems,
  type LiveNode,
  type VaultNode,
} from "./import";
import type { NoteKind } from "./paths";

const vault = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({
  format: "yatindora.notes.vault",
  version: 1,
  exportedAt: "2026-08-03T09:12:44.108Z",
  count: nodes.length,
  nodes,
  ...extra,
});

const vnode = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  parentId: null,
  kind: "QUESTION",
  title: id,
  slug: id,
  path: `/${id}`,
  depth: 0,
  sortOrder: 0,
  body: "",
  tags: [],
  confidence: 0,
  lastRevisedAt: null,
  ...over,
});

const ok = (raw: unknown) => {
  const r = parseImport(raw);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error}`);
  return r;
};

const err = (raw: unknown) => {
  const r = parseImport(raw);
  if (r.ok) throw new Error("expected a refusal, got a parse");
  return r.error;
};

const byTitle = (nodes: VaultNode[], title: string) => nodes.find((n) => n.title === title)!;

const chain = (n: number) => {
  let node: Record<string, unknown> = { title: `level ${n}` };
  for (let i = n - 1; i >= 1; i--) node = { title: `level ${i}`, children: [node] };
  return [node];
};

describe("detectShape", () => {
  test("names the shape before either schema runs", () => {
    expect(detectShape(vault([]))).toBe("vault");
    expect(detectShape([])).toBe("nested");
    expect(detectShape({ notes: [] })).toBe("nested");
    expect(detectShape({ version: 1, notes: [{ title: "a" }] })).toBe("nested");
  });

  test("a nodes array is a vault even with the format string wrong", () => {
    expect(detectShape({ format: "something.else", nodes: [] })).toBe("vault");
  });

  test("anything else is nothing", () => {
    for (const raw of [null, undefined, 3, "text", true, {}, { hello: "world" }]) {
      expect(detectShape(raw)).toBeNull();
    }
  });
});

describe("nested outlines", () => {
  const outline = [
    {
      title: "DSA",
      children: [
        {
          title: "Graphs",
          children: [
            { title: "Dijkstra vs Bellman-Ford", body: "non-negative weights", tags: ["graphs"], confidence: "good" },
            "When is BFS enough?",
          ],
        },
        { title: "Dynamic Programming", children: [] },
      ],
    },
    { title: "System Design", children: [{ title: "Idempotency keys", body: "…", confidence: 2 }] },
  ];

  test("flattens parents before children, with the parentId chain intact", () => {
    const { shape, nodes } = ok(outline);
    expect(shape).toBe("nested");
    expect(nodes.map((n) => n.title)).toEqual([
      "DSA",
      "Graphs",
      "Dijkstra vs Bellman-Ford",
      "When is BFS enough?",
      "Dynamic Programming",
      "System Design",
      "Idempotency keys",
    ]);

    const at = new Map(nodes.map((n, i) => [n.id, i] as const));
    for (const [i, n] of nodes.entries()) {
      if (n.parentId === null) continue;
      expect(at.get(n.parentId)!).toBeLessThan(i);
    }

    const graphs = byTitle(nodes, "Graphs");
    expect(graphs.parentId).toBe(byTitle(nodes, "DSA").id);
    expect(byTitle(nodes, "Dijkstra vs Bellman-Ford").parentId).toBe(graphs.id);
    expect(byTitle(nodes, "Idempotency keys").parentId).toBe(byTitle(nodes, "System Design").id);
  });

  test("kind is inferred from containment, and an empty children list still means folder", () => {
    const { nodes } = ok(outline);
    expect(byTitle(nodes, "DSA").kind).toBe("FOLDER");
    expect(byTitle(nodes, "Graphs").kind).toBe("FOLDER");
    expect(byTitle(nodes, "Dynamic Programming").kind).toBe("FOLDER");
    expect(byTitle(nodes, "Idempotency keys").kind).toBe("QUESTION");
  });

  test("a bare string is a question with an empty body", () => {
    const { nodes } = ok(outline);
    const bfs = byTitle(nodes, "When is BFS enough?");
    expect(bfs.kind).toBe("QUESTION");
    expect(bfs.body).toBe("");
    expect(bfs.tags).toEqual([]);
    expect(bfs.confidence).toBe(0);
  });

  test("an explicit kind overrides what containment would have said", () => {
    const { nodes } = ok([{ title: "Empty on purpose", kind: "FOLDER" }]);
    expect(nodes[0]!.kind).toBe("FOLDER");
  });

  test("array order becomes sortOrder among siblings", () => {
    const { nodes } = ok(outline);
    expect(byTitle(nodes, "DSA").sortOrder).toBe(0);
    expect(byTitle(nodes, "System Design").sortOrder).toBe(1);
    expect(byTitle(nodes, "Graphs").sortOrder).toBe(0);
    expect(byTitle(nodes, "Dynamic Programming").sortOrder).toBe(1);
  });

  test("every top-level entry is a root", () => {
    const { nodes } = ok(outline);
    expect(fileRoots(nodes).map((n) => n.title)).toEqual(["DSA", "System Design"]);
  });

  test("the envelope form is the same file", () => {
    const bare = ok(outline).nodes.map((n) => n.title);
    expect(ok({ version: 1, notes: outline }).nodes.map((n) => n.title)).toEqual(bare);
  });

  test("two siblings with the same title both survive, with their own children", () => {
    const { nodes } = ok([
      {
        title: "DSA",
        children: [
          { title: "Graphs", children: ["What is a bridge?"] },
          { title: "Graphs", children: ["duplicate on purpose"] },
        ],
      },
    ]);
    const graphs = nodes.filter((n) => n.title === "Graphs");
    expect(graphs).toHaveLength(2);
    expect(nodes.filter((n) => n.parentId === graphs[0]!.id).map((n) => n.title)).toEqual(["What is a bridge?"]);
    expect(nodes.filter((n) => n.parentId === graphs[1]!.id).map((n) => n.title)).toEqual(["duplicate on purpose"]);
  });
});

describe("field coercion", () => {
  test("a confidence word resolves through the same table the UI reads", () => {
    const { nodes } = ok([
      { title: "solid one", confidence: "solid" },
      { title: "again one", confidence: "again" },
      { title: "shouted", confidence: " SOLID " },
      { title: "unrated one" },
    ]);
    expect(nodes.map((n) => n.confidence)).toEqual([4, 1, 4, 0]);
  });

  test("a confidence integer is taken as it stands, and nonsense falls back to unrated", () => {
    const { nodes } = ok([
      { title: "three", confidence: 3 },
      { title: "stringly three", confidence: "3" },
      { title: "off the scale", confidence: 9 },
      { title: "negative", confidence: -1 },
      { title: "fractional", confidence: 2.5 },
      { title: "not a word", confidence: "excellent" },
    ]);
    expect(nodes.map((n) => n.confidence)).toEqual([3, 3, 0, 0, 0, 0]);
  });

  test("tags arrive as a list or as one comma-separated string", () => {
    const { nodes } = ok([
      { title: "list", tags: ["Graphs", "shortest-path"] },
      { title: "string", tags: "a, b" },
      { title: "messy", tags: " DSU , dsu ,, graphs " },
    ]);
    expect(nodes[0]!.tags).toEqual(["graphs", "shortest-path"]);
    expect(nodes[1]!.tags).toEqual(["a", "b"]);
    expect(nodes[2]!.tags).toEqual(["dsu", "graphs"]);
  });

  test("a vault file's lastRevisedAt survives as a date, and null stays null", () => {
    const { nodes } = ok(
      vault([
        vnode("a", { lastRevisedAt: "2026-07-19T11:02:00.000Z" }),
        vnode("b", { lastRevisedAt: null }),
      ]),
    );
    expect(nodes[0]!.lastRevisedAt).toEqual(new Date("2026-07-19T11:02:00.000Z"));
    expect(nodes[1]!.lastRevisedAt).toBeNull();
  });
});

describe("refusals", () => {
  test("a folder cannot carry an answer body, and the message names it", () => {
    const message = err([{ title: "DSA", body: "notes about DSA", children: ["a question"] }]);
    expect(message).toContain("DSA");
    expect(message).toMatch(/folder can't hold an answer/i);
  });

  test("an empty folder with a body is refused too", () => {
    expect(err([{ title: "Lonely", body: "text", children: [] }])).toMatch(/folder can't hold an answer/i);
  });

  test("a question named as a parent is refused", () => {
    expect(err([{ title: "Q", kind: "QUESTION", children: ["child"] }])).toMatch(/only folders can hold children/i);
  });

  test("an outline nested past the cap is refused with a sentence, not a RangeError", () => {
    const message = err(chain(MAX_DEPTH + 1));
    expect(message).toMatch(/levels deep/i);
    expect(message).not.toMatch(/call stack|RangeError/i);
    expect(ok(chain(MAX_DEPTH)).nodes).toHaveLength(MAX_DEPTH);
  });

  test("a hostile depth is refused rather than crashing the process", () => {
    let thrown: unknown = null;
    let refused = false;
    try {
      refused = !parseImport(chain(20_000)).ok;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(refused).toBe(true);
  });

  test("an empty file is refused rather than importing nothing", () => {
    expect(err([])).toMatch(/no notes/i);
    expect(err(vault([]))).toMatch(/no notes/i);
    expect(err({ notes: [] })).toMatch(/no notes/i);
  });

  test("a title is required, and the message says where", () => {
    expect(err([{ title: "ok" }, { title: "   " }])).toMatch(/title required/i);
    expect(err([{ title: "ok", children: [{ children: [] }] }])).toMatch(/title/i);
  });

  test("something that is not a file at all", () => {
    expect(err("just some text")).toMatch(/vault export or a nested outline/i);
    expect(err({ hello: "world" })).toMatch(/vault export or a nested outline/i);
  });
});

describe("vault files", () => {
  test("a folder export's top node is a root even though its parentId is not", () => {
    const { nodes } = ok(
      vault([
        vnode("top", { parentId: "not-in-this-file", kind: "FOLDER", title: "Graphs" }),
        vnode("kid", { parentId: "top", title: "Dijkstra" }),
      ]),
    );
    expect(fileRoots(nodes).map((n) => n.id)).toEqual(["top"]);
    expect(levelOrder(nodes).map((l) => l.map((n) => n.id))).toEqual([["top"], ["kid"]]);
    expect(summarise(nodes).roots).toBe(1);
  });

  test("a node pointing at itself is a root, not a lost node", () => {
    const { nodes } = ok(vault([vnode("self", { parentId: "self", kind: "FOLDER" })]));
    expect(fileRoots(nodes).map((n) => n.id)).toEqual(["self"]);
  });

  test("a parent cycle is refused before anything could be inserted", () => {
    const message = err(
      vault([
        vnode("a", { parentId: "b", kind: "FOLDER", title: "A" }),
        vnode("b", { parentId: "a", kind: "FOLDER", title: "B" }),
      ]),
    );
    expect(message).toMatch(/loops|own ancestor/i);
  });

  test("duplicate ids are refused", () => {
    expect(err(vault([vnode("same"), vnode("same", { title: "other" })]))).toMatch(/share the id/i);
  });

  test("a count that disagrees with the list is a truncated file", () => {
    expect(err(vault([vnode("a")], { count: 7 }))).toMatch(/truncated/i);
  });

  test("the format and version are checked, and the message says which field", () => {
    expect(err(vault([vnode("a")], { format: "someone.elses.vault" }))).toMatch(/format/i);
    expect(err(vault([vnode("a")], { version: 2 }))).toMatch(/version/i);
  });

  test("more nodes than an import will take", () => {
    const many = Array.from({ length: MAX_NODES + 1 }, (_, i) => vnode(`n${i}`));
    expect(err(vault(many))).toMatch(/too many notes/i);
  });

  test("slug, path and depth are accepted and then ignored", () => {
    const { nodes } = ok(vault([vnode("a", { slug: "lies", path: "/nowhere/at/all", depth: 47 })]));
    expect(nodes[0]!.title).toBe("a");
    expect(nodes[0]!.kind).toBe("QUESTION");
  });

  test("unknown keys are dropped rather than refused", () => {
    const { nodes } = ok(vault([vnode("a", { somethingNew: { deeply: ["nested"] } })]));
    expect(nodes[0]).not.toHaveProperty("somethingNew");
  });
});

describe("ordering", () => {
  const shuffled = [
    vnode("c", { parentId: "b", title: "C" }),
    vnode("a", { parentId: null, kind: "FOLDER", title: "A" }),
    vnode("b", { parentId: "a", kind: "FOLDER", title: "B", sortOrder: 0 }),
  ];

  test("topoOrder puts parents first however the file was ordered", () => {
    const { nodes } = ok(vault(shuffled));
    expect(topoOrder(nodes).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  test("siblings are ordered by sortOrder, and ties fall back to file order", () => {
    const { nodes } = ok(
      vault([
        vnode("second", { sortOrder: 5, title: "second" }),
        vnode("first", { sortOrder: 1, title: "first" }),
        vnode("tie-a", { sortOrder: 5, title: "tie-a" }),
      ]),
    );
    expect(fileRoots(nodes).map((n) => n.id)).toEqual(["first", "second", "tie-a"]);
  });

  test("levelOrder groups by depth, which is what lets the insert batch", () => {
    const { nodes } = ok(vault(shuffled));
    expect(levelOrder(nodes).map((l) => l.map((n) => n.id))).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("summarise", () => {
  test("counts what the dialog shows before anything is written", () => {
    const { nodes } = ok([
      {
        title: "DSA",
        children: [
          { title: "Graphs", children: [{ title: "Bridges", tags: ["graphs", "dfs"] }, "Tarjan"] },
          "A loose question",
        ],
      },
      { title: "Loose at the top" },
    ]);
    expect(summarise(nodes)).toEqual({
      folders: 2,
      questions: 4,
      roots: 2,
      maxDepth: 3,
      tags: ["dfs", "graphs"],
    });
  });
});

describe("vaultProblems", () => {
  test("answers directly, so importIn and the dialog cannot disagree", () => {
    const clean = flattenNested([{ title: "A", children: ["b"] }]);
    expect(vaultProblems(clean)).toEqual([]);
    expect(vaultProblems(clean, 2)).toEqual([]);
    expect(vaultProblems(clean, 3)[0]).toMatch(/truncated/i);
    expect(vaultProblems([])[0]).toMatch(/no notes/i);
  });
});

describe("planGraft", () => {
  const row = (
    id: string,
    parentId: string | null,
    slug: string,
    kind: NoteKind = "FOLDER",
  ): LiveNode => ({ id, parentId, slug, kind, sortOrder: 0 });

  test("the fixtures below carry real titles", () => {
    // flattenNested does not apply the bare-string shorthand
    expect(dsaTreesAvl().map((n) => n.title)).toEqual(["DSA", "Trees", "AVL rotations"]);
  });

  const dsaTreesAvl = () =>
    flattenNested([{ title: "DSA", children: [{ title: "Trees", children: [{ title: "AVL rotations" }] }] }]);

  test("follows the existing tree down as far as the names keep matching", () => {
    const file = dsaTreesAvl();
    const p = planGraft(file, null, [row("v-dsa", null, "dsa"), row("v-trees", "v-dsa", "trees")], "merge");

    expect(p.foldersReused).toBe(2);
    expect(p.foldersCreated).toBe(0);
    expect(p.questionsCreated).toBe(1);
    expect(p.merged.get(file[0]!.id)).toBe("v-dsa");
    expect(p.merged.get(file[1]!.id)).toBe("v-trees");
    expect(p.merged.has(file[2]!.id)).toBe(false);
  });

  test("stops where the names stop, and builds the rest", () => {
    const file = dsaTreesAvl();
    const p = planGraft(file, null, [row("v-dsa", null, "dsa")], "merge");

    expect(p.foldersReused).toBe(1);
    expect(p.foldersCreated).toBe(1);
    expect(p.questionsCreated).toBe(1);
  });

  test("a created folder ends the merge for everything beneath it", () => {
    const file = dsaTreesAvl();
    const p = planGraft(file, null, [row("v-other", null, "other"), row("v-trees", "v-other", "trees")], "merge");

    expect(p.foldersReused).toBe(0);
    expect(p.foldersCreated).toBe(2);
  });

  test("never merges a question, however exactly the name matches", () => {
    const file = flattenNested([{ title: "DSA", children: [{ title: "AVL rotations" }] }]);
    const live = [row("v-dsa", null, "dsa"), row("v-avl", "v-dsa", "avl-rotations", "QUESTION")];
    const p = planGraft(file, null, live, "merge");

    expect(p.foldersReused).toBe(1);
    expect(p.questionsCreated).toBe(1);
    expect(p.merged.has(file[1]!.id)).toBe(false);
  });

  test("will not graft a folder into a question wearing its name", () => {
    const file = flattenNested([{ title: "DSA", children: [{ title: "x" }] }]);
    const p = planGraft(file, null, [row("v-dsa", null, "dsa", "QUESTION")], "merge");

    expect(p.foldersReused).toBe(0);
    expect(p.foldersCreated).toBe(1);
  });

  test("two file folders of one name cannot both take the same live folder", () => {
    const file = flattenNested([
      { title: "DSA", children: [{ title: "a" }] },
      { title: "DSA", children: [{ title: "b" }] },
    ]);
    const p = planGraft(file, null, [row("v-dsa", null, "dsa")], "merge");

    expect(p.foldersReused).toBe(1);
    expect(p.foldersCreated).toBe(1);
  });

  test("matches on the slug, so case and spacing do not double a folder", () => {
    const file = flattenNested([{ title: "Dynamic  Programming", children: [{ title: "knapsack" }] }]);
    const p = planGraft(file, null, [row("v-dp", null, "dynamic-programming")], "merge");

    expect(p.foldersReused).toBe(1);
  });

  test("merges inside the destination, not wherever the name happens to appear", () => {
    const file = flattenNested([{ title: "DSA", children: [{ title: "x" }] }]);
    const live = [row("v-root-dsa", null, "dsa"), row("v-home", null, "home"), row("v-home-dsa", "v-home", "dsa")];
    const p = planGraft(file, "v-home", live, "merge");

    expect(p.foldersReused).toBe(1);
    expect(p.merged.get(file[0]!.id)).toBe("v-home-dsa");
  });

  test("a question never lands in a folder that shares its name", () => {
    const file = flattenNested([{ title: "Trees" }]);
    const p = planGraft(file, null, [row("v-trees", null, "trees")], "merge");

    expect(p.foldersReused).toBe(0);
    expect(p.questionsCreated).toBe(1);
    expect(p.merged.size).toBe(0);
  });

  test("create mode is the old behaviour, and reuses nothing", () => {
    const file = dsaTreesAvl();
    const p = planGraft(file, null, [row("v-dsa", null, "dsa"), row("v-trees", "v-dsa", "trees")], "create");

    expect(p.foldersReused).toBe(0);
    expect(p.foldersCreated).toBe(2);
    expect(p.questionsCreated).toBe(1);
    expect(p.merged.size).toBe(0);
  });
});
