import { describe, expect, test } from "bun:test";
import {
  ancestorPaths,
  buildTree,
  moveError,
  slugify,
  TRASH_PREFIX,
  tombstone,
  uniqueSlug,
  untomb,
  type TreeNode,
  type TreeRow,
} from "./paths";

const row = (r: Partial<TreeRow> & { id: string }): TreeRow => ({
  parentId: null,
  kind: "FOLDER",
  title: r.id,
  slug: r.id,
  path: "/" + r.id,
  depth: 0,
  sortOrder: 0,
  ...r,
});

const ids = (nodes: TreeNode[]): string[] => nodes.map((n) => n.id);
const count = (nodes: TreeNode[]): number =>
  nodes.reduce((n, node) => n + 1 + count(node.children), 0);

describe("slugify", () => {
  test("lowercases, hyphenates and collapses", () => {
    expect(slugify("  Union   Find  ")).toBe("union-find");
    expect(slugify("Dynamic Programming!")).toBe("dynamic-programming");
    expect(slugify("A -- B")).toBe("a-b");
  });

  test("drops the characters that would break a path", () => {
    expect(slugify("a/b")).toBe("ab");
    expect(slugify("~trash")).toBe("trash");
  });

  test("falls back rather than returning an empty segment", () => {
    expect(slugify("???")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
    expect(slugify("---")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  test("leaves a free base alone", () => {
    expect(uniqueSlug("dp", [])).toBe("dp");
    expect(uniqueSlug("dp", ["graphs"])).toBe("dp");
  });

  test("suffixes from 2 and keeps counting", () => {
    expect(uniqueSlug("dp", ["dp"])).toBe("dp-2");
    expect(uniqueSlug("dp", ["dp", "dp-2"])).toBe("dp-3");
    expect(uniqueSlug("dp", ["dp", "dp-2", "dp-3", "dp-4"])).toBe("dp-5");
  });

  test("takes the first free number, not the next one", () => {
    expect(uniqueSlug("dp", ["dp", "dp-3"])).toBe("dp-2");
  });
});

describe("moveError", () => {
  const dsa = { id: "n1", path: "/dsa", kind: "FOLDER" as const };
  const graphs = { id: "n2", path: "/dsa/graphs", kind: "FOLDER" as const };
  const os = { id: "n3", path: "/os", kind: "FOLDER" as const };
  const question = { id: "n4", path: "/os/paging", kind: "QUESTION" as const };

  test("moving to the root is always legal", () => {
    expect(moveError(dsa, null)).toBeNull();
  });

  test("a cross-branch move is legal", () => {
    expect(moveError(dsa, os)).toBeNull();
  });

  test("a node cannot be moved into itself", () => {
    expect(moveError(dsa, dsa)).toBe("A folder cannot contain itself");
  });

  test("a question can never be a destination", () => {
    expect(moveError(dsa, question)).toBe("Questions cannot hold children");
  });

  test("a folder cannot be moved into its own descendant", () => {
    expect(moveError(dsa, graphs)).toBe(
      "Cannot move a folder into its own descendant",
    );
    expect(
      moveError(dsa, { id: "n5", path: "/dsa/graphs/dijkstra", kind: "FOLDER" }),
    ).toBe("Cannot move a folder into its own descendant");
  });

  test("a sibling that merely shares a name prefix is not a descendant", () => {
    expect(moveError(dsa, { id: "n6", path: "/dsa-2", kind: "FOLDER" })).toBeNull();
    expect(
      moveError(dsa, { id: "n7", path: "/dsa-2/graphs", kind: "FOLDER" }),
    ).toBeNull();
  });

  test("re-parenting to the folder it already sits in is legal", () => {
    expect(moveError(graphs, dsa)).toBeNull();
  });
});

describe("tombstone / untomb", () => {
  test("tombstoning prefixes the id so the live name is free", () => {
    expect(tombstone("n6", "/dsa/dp")).toBe("~trash/n6/dsa/dp");
    expect(tombstone("n6", "/dsa/dp").startsWith(TRASH_PREFIX)).toBe(true);
  });

  test("untomb inverts tombstone exactly", () => {
    expect(untomb(tombstone("n6", "/dsa/dp"))).toBe("/dsa/dp");
    expect(untomb(tombstone("n6", "/dsa"))).toBe("/dsa");
    expect(untomb(tombstone("065f0d1e-uuid-shaped", "/a/b/c"))).toBe("/a/b/c");
  });

  test("a path that was never tombstoned survives untouched", () => {
    expect(untomb("/dsa/dp")).toBe("/dsa/dp");
    expect(untomb("/")).toBe("/");
    expect(untomb("")).toBe("");
  });
});

describe("buildTree", () => {
  test("nests children under their parent", () => {
    const tree = buildTree([
      row({ id: "a" }),
      row({ id: "b", parentId: "a", path: "/a/b" }),
      row({ id: "c", parentId: "b", path: "/a/b/c" }),
    ]);
    expect(ids(tree)).toEqual(["a"]);
    expect(ids(tree[0]!.children)).toEqual(["b"]);
    expect(ids(tree[0]!.children[0]!.children)).toEqual(["c"]);
  });

  test("orders siblings by sortOrder at every level", () => {
    const tree = buildTree([
      row({ id: "b", sortOrder: 1 }),
      row({ id: "a", sortOrder: 0 }),
      row({ id: "y", parentId: "a", sortOrder: 1 }),
      row({ id: "x", parentId: "a", sortOrder: 0 }),
    ]);
    expect(ids(tree)).toEqual(["a", "b"]);
    expect(ids(tree[0]!.children)).toEqual(["x", "y"]);
  });

  test("breaks a sortOrder tie on id rather than on row order", () => {
    const rows = [row({ id: "c" }), row({ id: "a" }), row({ id: "b" })];
    expect(ids(buildTree(rows))).toEqual(["a", "b", "c"]);
    expect(ids(buildTree([...rows].reverse()))).toEqual(["a", "b", "c"]);
  });

  test("surfaces an orphan as a root instead of dropping it", () => {
    const tree = buildTree([
      row({ id: "a" }),
      row({ id: "lost", parentId: "gone", path: "/gone/lost" }),
    ]);
    expect(ids(tree)).toEqual(["a", "lost"]);
    expect(count(tree)).toBe(2);
  });

  test("keeps a row that points at itself", () => {
    const tree = buildTree([row({ id: "a", parentId: "a" })]);
    expect(ids(tree)).toEqual(["a"]);
    expect(tree[0]!.children).toEqual([]);
  });

  test("copies rows rather than mutating them", () => {
    const source = row({ id: "a" });
    const tree = buildTree([source]);
    expect(tree[0]).not.toBe(source);
    expect(source).not.toHaveProperty("children");
  });

  test("no rows, no tree", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("ancestorPaths", () => {
  test("walks down from the root and includes the path itself", () => {
    expect(ancestorPaths("/a/b/c")).toEqual(["/a", "/a/b", "/a/b/c"]);
    expect(ancestorPaths("/a")).toEqual(["/a"]);
  });

  test("the root has no trail", () => {
    expect(ancestorPaths("/")).toEqual([]);
    expect(ancestorPaths("")).toEqual([]);
  });
});
