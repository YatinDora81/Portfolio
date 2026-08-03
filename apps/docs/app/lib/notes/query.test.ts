import { test, expect, describe } from "bun:test";
import {
  CONF_LABELS,
  CONF_NAME,
  IS_WORDS,
  QUICK_FILTERS,
  parseQuery,
  isEmptyQuery,
  matchQuestion,
  matchFolder,
  terms,
  snippetParts,
  highlightParts,
  type Matchable,
} from "./query";

/** A question that passes every filter, so each test only states its own delta. */
function q(over: Partial<Matchable> = {}): Matchable {
  return {
    title: "Union find",
    path: "/dsa/graphs/union-find",
    deletedAt: null,
    body: "Disjoint set union with path compression.",
    tags: ["dsu", "graphs"],
    confidence: 3,
    lastRevisedAt: "2026-01-01",
    ancestorTitles: ["DSA", "Graphs"],
    ...over,
  };
}

const hit = (s: string, n: Matchable) => matchQuestion(n, parseQuery(s));
const plain = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

describe("vocabulary", () => {
  test("the scale, the is: words and the quick filters agree with each other", () => {
    expect(CONF_LABELS).toEqual(["unrated", "again", "shaky", "good", "solid"]);
    expect(CONF_NAME).toEqual({ unrated: 0, again: 1, shaky: 2, good: 3, solid: 4 });
    expect(IS_WORDS).toContain("untagged");
    expect(IS_WORDS).toContain("trashed");
    // Every confidence label is usable as `is:`, or the chips would lie.
    for (const l of CONF_LABELS) expect(IS_WORDS).toContain(l);
    expect(QUICK_FILTERS).toHaveLength(6);
    // A quick filter that does not parse is a button that does nothing.
    for (const f of QUICK_FILTERS) expect(parseQuery(f.q).bad).toEqual([]);
    expect(QUICK_FILTERS.map((f) => f.q)).toEqual([
      "conf:<=2", "is:never", "is:untagged", "is:empty", "has:code", "is:solid",
    ]);
  });
});

describe("parseQuery", () => {
  test("bare words are lowercased free text", () => {
    const p = parseQuery("Union Find");
    expect(p.text).toEqual(["union", "find"]);
    expect(p.phrases).toEqual([]);
    expect(p.raw).toBe("Union Find");
  });

  test("a quoted run is one phrase, spaces and all", () => {
    const p = parseQuery('dsu "path compression" tree');
    expect(p.phrases).toEqual(["path compression"]);
    expect(p.text).toEqual(["dsu", "tree"]);
  });

  test("tag:x and #x are the same token", () => {
    expect(parseQuery("tag:redis").tags).toEqual(["redis"]);
    expect(parseQuery("#redis").tags).toEqual(["redis"]);
    expect(parseQuery("#Redis").tags).toEqual(["redis"]);
  });

  test("both tag forms negate", () => {
    expect(parseQuery("-tag:redis").notTags).toEqual(["redis"]);
    expect(parseQuery("-tag:redis").tags).toEqual([]);
    expect(parseQuery("-#redis").notTags).toEqual(["redis"]);
  });

  test("in: takes a folder name or a path, and folder: is an alias", () => {
    expect(parseQuery("in:graphs").in).toEqual(["graphs"]);
    expect(parseQuery("in:/dsa").in).toEqual(["/dsa"]);
    expect(parseQuery("folder:graphs").in).toEqual(["graphs"]);
  });

  test("conf: takes every operator", () => {
    expect(parseQuery("conf:2").conf).toEqual([{ op: "=", v: 2 }]);
    expect(parseQuery("conf:=2").conf).toEqual([{ op: "=", v: 2 }]);
    expect(parseQuery("conf:>2").conf).toEqual([{ op: ">", v: 2 }]);
    expect(parseQuery("conf:<2").conf).toEqual([{ op: "<", v: 2 }]);
    expect(parseQuery("conf:>=2").conf).toEqual([{ op: ">=", v: 2 }]);
    expect(parseQuery("conf:<=2").conf).toEqual([{ op: "<=", v: 2 }]);
  });

  test("conf: takes a name as well as a number", () => {
    expect(parseQuery("conf:shaky").conf).toEqual([{ op: "=", v: 2 }]);
    expect(parseQuery("conf:>=good").conf).toEqual([{ op: ">=", v: 3 }]);
    expect(parseQuery("conf:unrated").conf).toEqual([{ op: "=", v: 0 }]);
  });

  test("is: is validated against the word list and negates", () => {
    expect(parseQuery("is:untagged").is).toEqual(["untagged"]);
    expect(parseQuery("-is:solid").notIs).toEqual(["solid"]);
    expect(parseQuery("-is:solid").is).toEqual([]);
  });

  test("has: is validated too", () => {
    expect(parseQuery("has:code").has).toEqual(["code"]);
    expect(parseQuery("has:tag has:answer").has).toEqual(["tag", "answer"]);
  });

  test("an unknown key is reported, never silently dropped", () => {
    expect(parseQuery("banana:x").bad).toEqual(["banana:"]);
    expect(parseQuery("banana:x").text).toEqual([]);
    // ...including when it has no value, which the reference let through.
    expect(parseQuery("banana:").bad).toEqual(["banana:"]);
  });

  test("an unknown value on a known key is reported", () => {
    expect(parseQuery("is:banana").bad).toEqual(["is:banana"]);
    expect(parseQuery("is:banana").is).toEqual([]);
    expect(parseQuery("conf:banana").bad).toEqual(["conf:banana"]);
    expect(parseQuery("has:diagram").bad).toEqual(["has:diagram"]);
    expect(parseQuery("has:diagram").has).toEqual([]);
  });

  test("a known key mid-keystroke is not an error", () => {
    expect(parseQuery("tag:").bad).toEqual([]);
    expect(parseQuery("conf:").bad).toEqual([]);
    expect(parseQuery("is:").bad).toEqual([]);
    expect(isEmptyQuery(parseQuery("tag:"))).toBe(true);
  });

  test("five kinds of filter in one query all survive", () => {
    const p = parseQuery('union "path compression" #dsu -tag:redis in:graphs conf:<=2 -is:solid has:code');
    expect(p.text).toEqual(["union"]);
    expect(p.phrases).toEqual(["path compression"]);
    expect(p.tags).toEqual(["dsu"]);
    expect(p.notTags).toEqual(["redis"]);
    expect(p.in).toEqual(["graphs"]);
    expect(p.conf).toEqual([{ op: "<=", v: 2 }]);
    expect(p.notIs).toEqual(["solid"]);
    expect(p.has).toEqual(["code"]);
    expect(p.bad).toEqual([]);
  });

  test("a quoted value on a keyed filter keeps its spaces", () => {
    expect(parseQuery('tag:"machine learning"').tags).toEqual(["machine learning"]);
  });
});

describe("isEmptyQuery", () => {
  test("empty and whitespace-only queries ask for nothing", () => {
    expect(isEmptyQuery(parseQuery(""))).toBe(true);
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery("\n\t "))).toBe(true);
  });

  test("a query of nothing but typos is still empty, so results do not vanish", () => {
    expect(isEmptyQuery(parseQuery("banana:x"))).toBe(true);
  });

  test("any one filter makes it non-empty", () => {
    expect(isEmptyQuery(parseQuery("union"))).toBe(false);
    expect(isEmptyQuery(parseQuery("#dsu"))).toBe(false);
    expect(isEmptyQuery(parseQuery("conf:<=2"))).toBe(false);
    expect(isEmptyQuery(parseQuery("-is:solid"))).toBe(false);
  });
});

describe("matchQuestion", () => {
  test("free text spans title, body and tags", () => {
    expect(hit("union", q())).toBe(true);
    expect(hit("disjoint", q())).toBe(true);
    expect(hit("dsu", q())).toBe(true);
    expect(hit("bellman", q())).toBe(false);
  });

  test("two words both have to land", () => {
    expect(hit("union compression", q())).toBe(true);
    expect(hit("union bellman", q())).toBe(false);
  });

  test("a phrase is exact where loose words are not", () => {
    expect(hit('"path compression"', q())).toBe(true);
    expect(hit('"compression path"', q())).toBe(false);
  });

  test("tag: includes and -tag: excludes", () => {
    expect(hit("tag:dsu", q())).toBe(true);
    expect(hit("#graphs", q())).toBe(true);
    expect(hit("tag:redis", q())).toBe(false);
    expect(hit("-tag:redis", q())).toBe(true);
    expect(hit("-tag:dsu", q())).toBe(false);
  });

  test("in: scopes by path prefix", () => {
    expect(hit("in:/dsa", q())).toBe(true);
    expect(hit("in:dsa", q())).toBe(true);
    expect(hit("in:/trees", q())).toBe(false);
  });

  test("in: also scopes by folder name, using the ancestors the caller supplied", () => {
    expect(hit("in:graphs", q())).toBe(true);
    // Without ancestors there is nothing but the path to go on, and "graphs"
    // is not a path prefix here.
    expect(hit("in:graphs", q({ ancestorTitles: undefined }))).toBe(false);
    expect(hit("in:/dsa", q({ ancestorTitles: undefined }))).toBe(true);
  });

  test("conf: compares against the stored integer", () => {
    expect(hit("conf:3", q())).toBe(true);
    expect(hit("conf:good", q())).toBe(true);
    expect(hit("conf:<=2", q())).toBe(false);
    expect(hit("conf:<=2", q({ confidence: 1 }))).toBe(true);
    expect(hit("conf:>2", q())).toBe(true);
    expect(hit("conf:>=3 conf:<4", q())).toBe(true);
  });

  test("is: covers the answer's own facts", () => {
    expect(hit("is:untagged", q({ tags: [] }))).toBe(true);
    expect(hit("is:untagged", q())).toBe(false);
    expect(hit("is:empty", q({ body: "" }))).toBe(true);
    expect(hit("is:empty", q())).toBe(false);
    expect(hit("is:never", q({ lastRevisedAt: null }))).toBe(true);
    expect(hit("is:revised", q())).toBe(true);
    expect(hit("is:solid", q({ confidence: 4 }))).toBe(true);
  });

  test("-is: inverts each of them", () => {
    expect(hit("-is:solid", q())).toBe(true);
    expect(hit("-is:solid", q({ confidence: 4 }))).toBe(false);
    expect(hit("-is:untagged", q())).toBe(true);
    expect(hit("-is:never", q())).toBe(true);
    expect(hit("-is:never", q({ lastRevisedAt: null }))).toBe(false);
  });

  test("has:code needs a fenced block, not the word code", () => {
    expect(hit("has:code", q())).toBe(false);
    expect(hit("has:code", q({ body: "see:\n```ts\nfind(x)\n```" }))).toBe(true);
    expect(hit("has:tag", q())).toBe(true);
    expect(hit("has:tag", q({ tags: [] }))).toBe(false);
    expect(hit("has:answer", q())).toBe(true);
    expect(hit("has:answer", q({ body: "" }))).toBe(false);
  });

  test("trashed rows appear for is:trashed and for nothing else", () => {
    const dead = q({ deletedAt: new Date("2026-02-02") });
    expect(hit("union", dead)).toBe(false);
    expect(hit("", dead)).toBe(false);
    expect(hit("is:untagged", q({ tags: [], deletedAt: new Date() }))).toBe(false);
    expect(hit("is:trashed", dead)).toBe(true);
    expect(hit("union is:trashed", dead)).toBe(true);
    // ...and a live row is not in the trash view.
    expect(hit("is:trashed", q())).toBe(false);
  });

  test("an unknown filter changes nothing about what matched", () => {
    expect(hit("union banana:x", q())).toBe(true);
  });
});

/**
 * The cases where this matcher and `toPrismaWhere` could plausibly disagree, and
 * where a disagreement would be invisible: both engines return rows either way,
 * so nothing fails, the tree filter and the search page just quietly answer the
 * same query differently. Each of these was a real divergence.
 */
describe("matchQuestion · agreement with the SQL compiler", () => {
  test("a tag matches whole, never by substring", () => {
    // `tags @> ARRAY['grap']` is false for a tag of "graphs", so this has to be
    // false here too.
    expect(hit("tag:grap", q())).toBe(false);
    expect(hit("tag:graphs", q())).toBe(true);
    expect(hit("-tag:grap", q())).toBe(true);
  });

  test("free text reaches a tag whole, and only whole", () => {
    expect(hit("dsu", q({ title: "T", body: "" }))).toBe(true);
    expect(hit("ds", q({ title: "T", body: "" }))).toBe(false);
  });

  test("a phrase does not match across the seam between two fields", () => {
    // The haystack version concatenated title + body + tags and matched here;
    // `title contains OR body contains` cannot, and it is the one that runs on
    // the search page.
    expect(hit('"find disjoint"', q())).toBe(false);
    expect(hit('"union find"', q())).toBe(true);
  });

  test("in: takes the folder and its subtree, not the sibling next to it", () => {
    const sibling = q({ path: "/dsa-archive/old", ancestorTitles: undefined });
    expect(hit("in:/dsa", sibling)).toBe(false);
    expect(hit("in:/dsa-archive", sibling)).toBe(true);
    // The folder's own row is inside its own scope.
    expect(hit("in:/dsa", q({ path: "/dsa", ancestorTitles: undefined }))).toBe(true);
    expect(hit("in:/dsa/", q())).toBe(true);
  });

  test("a question nobody has answered is unrated, empty, untagged and never revised", () => {
    // What `answer?.confidence ?? 0` flattens to. The SQL side spells the same
    // question out as an explicit `answer: null` branch; if these two readings
    // ever part, `conf:<=2` means different things in the tree and in search.
    const blank = q({ body: "", tags: [], confidence: 0, lastRevisedAt: null });
    expect(hit("conf:<=2", blank)).toBe(true);
    expect(hit("is:unrated", blank)).toBe(true);
    expect(hit("is:empty", blank)).toBe(true);
    expect(hit("is:untagged", blank)).toBe(true);
    expect(hit("is:never", blank)).toBe(true);
    expect(hit("-is:solid", blank)).toBe(true);
    expect(hit("-tag:redis", blank)).toBe(true);
    // ...and nothing more than that.
    expect(hit("conf:>2", blank)).toBe(false);
    expect(hit("-is:unrated", blank)).toBe(false);
    expect(hit("is:solid", blank)).toBe(false);
    expect(hit("has:code", blank)).toBe(false);
    expect(hit("has:answer", blank)).toBe(false);
    expect(hit("tag:redis", blank)).toBe(false);
  });
});

describe("matchFolder", () => {
  const f = { title: "Graphs", deletedAt: null };

  test("a folder matches on its own name only", () => {
    expect(matchFolder(f, parseQuery("graphs"))).toBe(true);
    expect(matchFolder(f, parseQuery("grap"))).toBe(true);
    expect(matchFolder(f, parseQuery("trees"))).toBe(false);
  });

  test("every word has to land, phrases included", () => {
    expect(matchFolder({ title: "Union find", deletedAt: null }, parseQuery('"union find"'))).toBe(true);
    expect(matchFolder(f, parseQuery("graphs trees"))).toBe(false);
  });

  test("a folder is never matched by a filter that describes an answer", () => {
    expect(matchFolder(f, parseQuery("graphs tag:dsu"))).toBe(false);
    expect(matchFolder(f, parseQuery("graphs conf:<=2"))).toBe(false);
    expect(matchFolder(f, parseQuery("graphs is:untagged"))).toBe(false);
    expect(matchFolder(f, parseQuery("graphs has:code"))).toBe(false);
  });

  test("with no words at all there is nothing to match a name against", () => {
    expect(matchFolder(f, parseQuery(""))).toBe(false);
    expect(matchFolder(f, parseQuery("in:/dsa"))).toBe(false);
  });

  test("a trashed folder never matches", () => {
    expect(matchFolder({ title: "Graphs", deletedAt: new Date() }, parseQuery("graphs"))).toBe(false);
  });
});

describe("terms", () => {
  test("words and phrases are paintable, single characters are not", () => {
    expect(terms(parseQuery('union "path compression" a'))).toEqual(["union", "path compression"]);
    expect(terms(parseQuery("tag:dsu conf:<=2"))).toEqual([]);
  });
});

describe("highlightParts", () => {
  test("a term splits the text into runs and marks its own", () => {
    expect(highlightParts("union find", ["find"])).toEqual([
      { text: "union ", hit: false },
      { text: "find", hit: true },
    ]);
  });

  test("matching is case-insensitive but the original casing is kept", () => {
    expect(highlightParts("Union Find", ["union"])).toEqual([
      { text: "Union", hit: true },
      { text: " Find", hit: false },
    ]);
  });

  test("no match is one unmarked run, empty text is nothing at all", () => {
    expect(highlightParts("union find", ["redis"])).toEqual([{ text: "union find", hit: false }]);
    expect(highlightParts("", ["union"])).toEqual([]);
  });

  test("regex metacharacters in a term are literal, not a pattern", () => {
    expect(highlightParts("c++ and c#", ["c++"])).toEqual([
      { text: "c++", hit: true },
      { text: " and c#", hit: false },
    ]);
    expect(highlightParts("a|b", ["a|b"])).toEqual([{ text: "a|b", hit: true }]);
    expect(highlightParts("x.y", ["."])).toEqual([
      { text: "x", hit: false },
      { text: ".", hit: true },
      { text: "y", hit: false },
    ]);
    // A metacharacter term that would throw if compiled raw.
    expect(() => highlightParts("a(b", ["(b"])).not.toThrow();
  });

  test("HTML-significant characters are matched, not escaped away", () => {
    expect(highlightParts("a&b < c", ["a&b"])).toEqual([
      { text: "a&b", hit: true },
      { text: " < c", hit: false },
    ]);
  });

  test("overlapping terms merge into one run instead of nesting", () => {
    expect(highlightParts("foobar", ["foo", "oob"])).toEqual([
      { text: "foob", hit: true },
      { text: "ar", hit: false },
    ]);
  });

  test("a later term never matches inside an earlier term's markup", () => {
    // The string-replace version painted "hit" inside its own <span class="hit">.
    const parts = highlightParts("span class hit", ["span", "hit"]);
    expect(parts).toHaveLength(3);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["span", "hit"]);
  });

  test("every occurrence is painted, not just the first", () => {
    expect(highlightParts("dp then dp", ["dp"]).filter((p) => p.hit)).toHaveLength(2);
  });
});

describe("snippetParts", () => {
  test("fenced blocks collapse and newlines flatten", () => {
    const parts = snippetParts("before\n```js\ncode here\n```\nafter", parseQuery("before"));
    expect(plain(parts)).toBe("before [code] after");
    expect(parts[0]).toEqual({ text: "before", hit: true });
  });

  test("backticks and runs of whitespace flatten too", () => {
    expect(plain(snippetParts("use `find(x)`   twice", parseQuery("twice")))).toBe("use find(x) twice");
  });

  test("an empty or whitespace-only body has no snippet", () => {
    expect(snippetParts("", parseQuery("union"))).toEqual([]);
    expect(snippetParts("   \n  ", parseQuery("union"))).toEqual([]);
  });

  test("a short body is shown whole, with no ellipsis on either side", () => {
    const parts = snippetParts("union find is a forest", parseQuery("find"));
    expect(plain(parts)).toBe("union find is a forest");
  });

  test("the window opens ~45 chars before the first hit and runs 165", () => {
    const body = "x".repeat(60) + " needle " + "y".repeat(300);
    const parts = snippetParts(body, parseQuery("needle"));
    expect(parts[0]).toEqual({ text: "…", hit: false });
    expect(parts[parts.length - 1]).toEqual({ text: "…", hit: false });
    const window = plain(parts.slice(1, -1));
    expect(window).toHaveLength(165);
    expect(window.indexOf("needle")).toBe(45);
    expect(parts.some((p) => p.hit && p.text === "needle")).toBe(true);
  });

  test("a hit near the start cuts only the tail", () => {
    const parts = snippetParts("needle " + "y".repeat(300), parseQuery("needle"));
    expect(parts[0]).toEqual({ text: "needle", hit: true });
    expect(parts[parts.length - 1]).toEqual({ text: "…", hit: false });
  });

  test("a hit near the end cuts only the head", () => {
    const body = "y".repeat(300) + " needle";
    const parts = snippetParts(body, parseQuery("needle"));
    expect(parts[0]).toEqual({ text: "…", hit: false });
    expect(parts[parts.length - 1]).toEqual({ text: "needle", hit: true });
  });

  test("with no term to centre on, the snippet starts at the beginning", () => {
    const parts = snippetParts("a".repeat(400), parseQuery("tag:dsu"));
    expect(parts[0]!.hit).toBe(false);
    expect(parts[0]!.text.startsWith("…")).toBe(false);
    expect(parts[0]!.text).toHaveLength(165);
    expect(parts[1]).toEqual({ text: "…", hit: false });
  });

  test("a term that is only in the title does not move the window", () => {
    const parts = snippetParts("y".repeat(300), parseQuery("union"));
    expect(plain(parts).startsWith("y")).toBe(true);
    expect(plain(parts)).toHaveLength(166);
  });
});
