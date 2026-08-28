import { describe, expect, test } from "bun:test";
import {
  folderMarkdown,
  questionMarkdown,
  safeFilename,
  treeOrder,
  vaultJson,
  yamlString,
  zipEntryName,
  type ExportRow,
} from "./export";

const row = (r: Partial<ExportRow> & { id: string }): ExportRow => ({
  parentId: null,
  kind: "QUESTION",
  title: r.id,
  slug: r.id,
  path: `/${r.id}`,
  depth: 0,
  sortOrder: 0,
  answer: null,
  ...r,
});

const answer = (a: Partial<NonNullable<ExportRow["answer"]>> = {}) => ({
  body: "",
  tags: [],
  confidence: 0,
  lastRevisedAt: null,
  ...a,
});

function frontMatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("no front matter");
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(": ");
    out[line.slice(0, i)] = line.slice(i + 2);
  }
  return out;
}

const unquote = (v: string): string => JSON.parse(v) as string;

describe("yamlString", () => {
  test("quotes and escapes the characters that would end the scalar early", () => {
    expect(yamlString("plain")).toBe('"plain"');
    expect(yamlString('He said "hi"')).toBe('"He said \\"hi\\""');
    expect(yamlString("C:\\path")).toBe('"C:\\\\path"');
    expect(yamlString("a\tb")).toBe('"a\\tb"');
  });

  test("escapes control characters rather than emitting them raw", () => {
    expect(yamlString("a\u0007b")).toBe('"a\\u0007b"');
    expect(yamlString("a\u007fb")).toBe('"a\\u007fb"');
  });

  test("survives the strings a bare scalar would resolve to another type", () => {
    for (const s of ["yes", "no", "true", "false", "null", "~", "3", "3.0", "2026-08-03", "on", "off"]) {
      expect(unquote(yamlString(s))).toBe(s);
    }
  });
});

describe("questionMarkdown front matter", () => {
  test("a colon in the title does not produce a second key", () => {
    const md = questionMarkdown(
      { title: "Dijkstra: shortest path", path: "/dsa/graphs/dijkstra" },
      answer({ confidence: 4 }),
    );
    const fm = frontMatter(md);
    expect(Object.keys(fm)).toEqual(["title", "path", "tags", "confidence", "lastRevisedAt"]);
    expect(unquote(fm.title!)).toBe("Dijkstra: shortest path");
  });

  test("quotes, backslashes and hashes in a title stay readable back out", () => {
    for (const title of [
      'What does "amortised" mean?',
      "C:\\Users\\me — a path",
      "Cost # per op",
      "- leading dash",
      "trailing colon:",
      "{braces} [brackets] & anchors *stars*",
    ]) {
      const fm = frontMatter(questionMarkdown({ title, path: "/x" }, null));
      expect(unquote(fm.title!)).toBe(title);
    }
  });

  test("a newline in a title is collapsed instead of splitting the block", () => {
    const md = questionMarkdown({ title: "two\nlines", path: "/x" }, null);
    expect(frontMatter(md).title).toBe('"two lines"');
    expect(md).toContain("# two lines");
  });

  test("carries tags, confidence label and revision stamp", () => {
    const fm = frontMatter(
      questionMarkdown(
        { title: "Union find", path: "/dsa/union-find" },
        answer({ tags: ["dsa", "graphs"], confidence: 3, lastRevisedAt: "2026-07-11T09:00:00.000Z" }),
      ),
    );
    expect(fm.tags).toBe('["dsa", "graphs"]');
    expect(fm.confidence).toBe('"good"');
    expect(fm.lastRevisedAt).toBe('"2026-07-11T09:00:00.000Z"');
  });

  test("a tag holding a quote cannot break the flow sequence", () => {
    const fm = frontMatter(questionMarkdown({ title: "t", path: "/t" }, answer({ tags: ['a"b', "c, d"] })));
    expect(JSON.parse(fm.tags!)).toEqual(['a"b', "c, d"]);
  });

  test("an absent answer is unrated, untagged and never revised", () => {
    const fm = frontMatter(questionMarkdown({ title: "t", path: "/t" }, null));
    expect(fm.tags).toBe("[]");
    expect(fm.confidence).toBe('"unrated"');
    expect(fm.lastRevisedAt).toBe("null");
  });
});

describe("questionMarkdown body", () => {
  test("the body is emitted verbatim under an H1", () => {
    const body = "Line one.\n\n```ts\nconst x: number = 1;\n```\n\n- a\n- b";
    const md = questionMarkdown({ title: "Types", path: "/ts/types" }, answer({ body }));
    expect(md).toContain("\n# Types\n\n");
    expect(md).toContain(body);
  });

  test("a body opening with a rule is not mistaken for more front matter", () => {
    const md = questionMarkdown({ title: "T", path: "/t" }, answer({ body: "---\nafter" }));
    expect(md.indexOf("# T")).toBeLessThan(md.indexOf("---\nafter"));
    expect(frontMatter(md).title).toBe('"T"');
  });

  test("an empty body leaves no trailing blank block", () => {
    expect(questionMarkdown({ title: "T", path: "/t" }, answer())).toEndWith("\n# T\n");
  });
});

describe("treeOrder", () => {
  const rows = [
    row({ id: "b", parentId: "root", sortOrder: 1 }),
    row({ id: "a", parentId: "root", sortOrder: 0 }),
    row({ id: "a1", parentId: "a", sortOrder: 0 }),
    row({ id: "root", parentId: "outside" }),
  ];

  test("depth-first, siblings by sortOrder, with an absent parent read as a root", () => {
    expect(treeOrder(rows).map((r) => r.id)).toEqual(["root", "a", "a1", "b"]);
  });

  test("ties break on id so an unchanged vault exports identically twice", () => {
    const tied = [row({ id: "z", parentId: null }), row({ id: "y", parentId: null })];
    expect(treeOrder(tied).map((r) => r.id)).toEqual(["y", "z"]);
  });

  test("a parent cycle strands nobody", () => {
    const cyclic = [row({ id: "p", parentId: "q" }), row({ id: "q", parentId: "p" })];
    expect(treeOrder(cyclic).map((r) => r.id).sort()).toEqual(["p", "q"]);
  });
});

describe("folderMarkdown", () => {
  const rows: ExportRow[] = [
    row({ id: "f", kind: "FOLDER", title: "Graphs", slug: "graphs", path: "/dsa/graphs", depth: 1, parentId: "dsa" }),
    row({
      id: "q1",
      title: "Dijkstra",
      slug: "dijkstra",
      path: "/dsa/graphs/dijkstra",
      depth: 2,
      parentId: "f",
      answer: answer({ body: "Greedy over a min-heap.", tags: ["graphs"], confidence: 4 }),
    }),
    row({
      id: "q2",
      title: "BFS",
      slug: "bfs",
      path: "/dsa/graphs/bfs",
      depth: 2,
      parentId: "f",
      sortOrder: 1,
      answer: answer({ confidence: 1 }),
    }),
  ];

  test("heading depth tracks tree depth from the export's own root", () => {
    const md = folderMarkdown(rows);
    expect(md).toContain("# Graphs");
    expect(md).toContain("## Dijkstra");
    expect(md).not.toContain("### ");
  });

  test("each entry carries its path, its confidence and its tags", () => {
    const md = folderMarkdown(rows);
    expect(md).toContain("`/dsa/graphs/dijkstra` · solid · `graphs`");
    expect(md).toContain("`/dsa/graphs/bfs` · again");
    expect(md).toContain("`/dsa/graphs`\n");
  });

  test("questions follow tree order, not the order the rows arrived in", () => {
    const md = folderMarkdown(rows);
    expect(md.indexOf("## Dijkstra")).toBeLessThan(md.indexOf("## BFS"));
  });

  test("heading depth is capped at h6 rather than emitting seven hashes", () => {
    const deep = [
      row({ id: "r", kind: "FOLDER", depth: 0 }),
      ...Array.from({ length: 9 }, (_, i) =>
        row({ id: `n${i}`, parentId: i === 0 ? "r" : `n${i - 1}`, title: `N${i}`, depth: i + 1 }),
      ),
    ];
    const md = folderMarkdown(deep);
    expect(md).toContain("###### N8");
    expect(md).not.toContain("####### ");
  });

  test("an empty selection is an empty document, not a stray newline", () => {
    expect(folderMarkdown([])).toBe("");
  });
});

describe("vaultJson", () => {
  const rows: ExportRow[] = [
    row({ id: "kid", parentId: "top", title: "Kid", slug: "kid", path: "/top/kid", depth: 1, sortOrder: 3,
      answer: answer({ body: "b", tags: ["t"], confidence: 2, lastRevisedAt: "2026-01-01T00:00:00.000Z" }) }),
    row({ id: "top", kind: "FOLDER", title: "Top", slug: "top", path: "/top" }),
  ];

  test("every column survives the round trip", () => {
    const doc = JSON.parse(vaultJson(rows, "2026-08-03T00:00:00.000Z"));
    expect(doc.format).toBe("yatindora.notes.vault");
    expect(doc.version).toBe(1);
    expect(doc.exportedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(doc.count).toBe(2);
    expect(doc.nodes[1]).toEqual({
      id: "kid",
      parentId: "top",
      kind: "QUESTION",
      title: "Kid",
      slug: "kid",
      path: "/top/kid",
      depth: 1,
      sortOrder: 3,
      body: "b",
      tags: ["t"],
      confidence: 2,
      lastRevisedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("a parent always precedes its children, so an importer can insert in one pass", () => {
    const doc = JSON.parse(vaultJson(rows, "x"));
    const at = new Map<string, number>(doc.nodes.map((n: { id: string }, i: number) => [n.id, i]));
    for (const n of doc.nodes) {
      if (n.parentId && at.has(n.parentId)) expect(at.get(n.parentId)!).toBeLessThan(at.get(n.id)!);
    }
  });

  test("a folder reports an empty answer rather than a missing one", () => {
    const doc = JSON.parse(vaultJson(rows, "x"));
    expect(doc.nodes[0]).toMatchObject({ kind: "FOLDER", body: "", tags: [], confidence: 0, lastRevisedAt: null });
  });
});

describe("safeFilename", () => {
  test("drops the characters no filesystem in the set accepts", () => {
    expect(safeFilename("Dijkstra: shortest path", "md")).toBe("Dijkstra shortest path.md");
    expect(safeFilename("a/b\\c", "md")).toBe("a b c.md");
    expect(safeFilename('why? <this> "that" | *', "md")).toBe("why this that.md");
  });

  test("no trailing dot or space, which Windows silently eats", () => {
    expect(safeFilename("report...", "md")).toBe("report.md");
    expect(safeFilename("report   ", "md")).toBe("report.md");
    expect(safeFilename("report . ", "md")).toBe("report.md");
  });

  test("no leading dot, which would hide the file or name nothing at all", () => {
    expect(safeFilename(".hidden", "md")).toBe("hidden.md");
    expect(safeFilename("..", "md")).toBe("untitled.md");
  });

  test("never empty", () => {
    expect(safeFilename("", "md")).toBe("untitled.md");
    expect(safeFilename("   ", "md")).toBe("untitled.md");
    expect(safeFilename("///", "md")).toBe("untitled.md");
  });

  test("moves the reserved DOS device names out of the way", () => {
    for (const name of ["CON", "con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "LPT9"]) {
      expect(safeFilename(name, "md")).toBe(`_${name}.md`);
    }
    // Windows reads the device name off the text before the first dot.
    expect(safeFilename("CON.md", "md")).toBe("_CON.md.md");
  });

  test("leaves the near misses alone", () => {
    expect(safeFilename("console", "md")).toBe("console.md");
    expect(safeFilename("COM0", "md")).toBe("COM0.md");
    expect(safeFilename("COM10", "md")).toBe("COM10.md");
    expect(safeFilename("NULL", "md")).toBe("NULL.md");
  });

  test("caps the length, and re-strips what the cut exposes", () => {
    const long = safeFilename("a".repeat(300), "md");
    expect(long.length).toBeLessThanOrEqual(70);
    expect(long).toEndWith(".md");
    expect(safeFilename(`${"a".repeat(62)}.. tail`, "md")).toBe(`${"a".repeat(62)}.md`);
  });

  test("keeps non-ASCII, and takes the extension with or without its dot", () => {
    expect(safeFilename("图论", "md")).toBe("图论.md");
    expect(safeFilename("x", ".json")).toBe("x.json");
    expect(safeFilename("x", "")).toBe("x");
  });
});

describe("zipEntryName", () => {
  test("a vault path becomes a relative entry name", () => {
    expect(zipEntryName("/dsa/graphs/dijkstra", "md")).toBe("dsa/graphs/dijkstra.md");
  });

  test("a subtree export opens at the folder that was asked for", () => {
    expect(zipEntryName("/dsa/graphs/dijkstra", "md", "/dsa/")).toBe("graphs/dijkstra.md");
    expect(zipEntryName("/dsa/graphs", "md", "/dsa/")).toBe("graphs.md");
  });

  test("a path outside the prefix is kept whole rather than half-cut", () => {
    expect(zipEntryName("/other/x", "md", "/dsa/")).toBe("other/x.md");
  });
});
