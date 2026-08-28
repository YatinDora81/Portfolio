import { describe, expect, test } from "bun:test";
import type { Prisma } from "db";
import type { ParsedQuery } from "./query";
import { toPrismaWhere } from "./query-sql";

function pq(over: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    text: [],
    phrases: [],
    tags: [],
    notTags: [],
    in: [],
    is: [],
    notIs: [],
    conf: [],
    has: [],
    raw: "",
    bad: [],
    ...over,
  };
}

function clauses(w: Prisma.NoteNodeWhereInput): Prisma.NoteNodeWhereInput[] {
  return (w.AND ?? []) as Prisma.NoteNodeWhereInput[];
}

function extra(w: Prisma.NoteNodeWhereInput): Prisma.NoteNodeWhereInput[] {
  return clauses(w).slice(2);
}

function inner(c: Prisma.NoteNodeWhereInput | undefined): Prisma.NoteAnswerWhereInput {
  const positive = (c?.OR?.[1] ?? c) as Prisma.NoteNodeWhereInput | undefined;
  const rel = positive?.answer as { is: Prisma.NoteAnswerWhereInput } | undefined;
  return rel?.is as Prisma.NoteAnswerWhereInput;
}

function complementOf(f: Prisma.NoteAnswerWhereInput): Prisma.NoteNodeWhereInput {
  return { OR: [{ answer: { is: null } }, { answer: { is: { NOT: f } } }] };
}

describe("toPrismaWhere · scope of the vault", () => {
  test("an empty query is questions, live only", () => {
    expect(toPrismaWhere(pq())).toEqual({ AND: [{ kind: "QUESTION" }, { deletedAt: null }] });
  });

  test("is:trashed flips deletedAt", () => {
    expect(clauses(toPrismaWhere(pq({ is: ["trashed"] })))[1]).toEqual({ deletedAt: { not: null } });
  });

  test("is:trashed is not also applied as an answer filter", () => {
    expect(extra(toPrismaWhere(pq({ is: ["trashed"] })))).toEqual([]);
  });

  test("-is:trashed leaves the live-only default alone", () => {
    expect(toPrismaWhere(pq({ notIs: ["trashed"] }))).toEqual({
      AND: [{ kind: "QUESTION" }, { deletedAt: null }],
    });
  });
});

describe("toPrismaWhere · free text", () => {
  test("a term searches title, body and tags", () => {
    const [clause] = extra(toPrismaWhere(pq({ text: ["union"] })));
    expect(clause?.OR).toHaveLength(3);
    expect(clause?.OR?.[0]).toEqual({ title: { contains: "union", mode: "insensitive" } });
    expect(clause?.OR?.[1]).toEqual({ answer: { is: { body: { contains: "union", mode: "insensitive" } } } });
  });

  test("the tag branch of free text is case-folded, because text[] containment is not", () => {
    const [clause] = extra(toPrismaWhere(pq({ text: ["redis"] })));
    const tags = (clause?.OR?.[2] as { answer: { is: { tags: { hasSome: string[] } } } }).answer.is.tags.hasSome;
    expect(tags).toContain("redis");
    expect(tags).toContain("Redis");
    expect(tags).toContain("REDIS");
  });

  test("every term and phrase ANDs a clause of its own", () => {
    expect(extra(toPrismaWhere(pq({ text: ["union", "find"], phrases: ["path compression"] })))).toHaveLength(3);
  });
});

describe("toPrismaWhere · tags", () => {
  test("tag:redis is answer-side containment", () => {
    expect(inner(extra(toPrismaWhere(pq({ tags: ["redis"] })))[0]).tags).toEqual({
      hasSome: ["redis", "REDIS", "Redis"],
    });
  });

  test("-tag:redis keeps questions that have no answer row at all", () => {
    const [clause] = extra(toPrismaWhere(pq({ notTags: ["redis"] })));
    expect(clause).toEqual(complementOf({ tags: { hasSome: ["redis", "REDIS", "Redis"] } }));
  });
});

describe("toPrismaWhere · in:", () => {
  test("a path term becomes the folder plus its subtree", () => {
    const [clause] = extra(toPrismaWhere(pq({ in: ["/dsa"] })));
    expect(clause).toEqual({
      OR: [
        { path: { equals: "/dsa", mode: "insensitive" } },
        { path: { startsWith: "/dsa/", mode: "insensitive" } },
      ],
    });
  });

  test("the separator is part of the prefix, so a sibling folder is not swallowed", () => {
    const [clause] = extra(toPrismaWhere(pq({ in: ["/dsa"] })));
    const branch = clause?.OR?.[1] as { path: { startsWith: string } };
    expect(branch.path.startsWith).toBe("/dsa/");
  });

  test("a trailing slash describes the same subtree", () => {
    expect(extra(toPrismaWhere(pq({ in: ["/dsa/"] })))).toEqual(extra(toPrismaWhere(pq({ in: ["/dsa"] }))));
  });

  test("a bare folder name nobody resolved matches nothing — it does not widen the search", () => {
    expect(extra(toPrismaWhere(pq({ in: ["graphs"] })))).toEqual([{ id: { in: [] } }]);
  });

  test("a bare folder name is scoped by the paths the caller resolved, not by its own spelling", () => {
    const [clause] = extra(toPrismaWhere(pq({ in: ["graphs"] }), ["/dsa/graphs"]));
    expect(clause).toEqual({
      OR: [
        { path: { equals: "/dsa/graphs", mode: "insensitive" } },
        { path: { startsWith: "/dsa/graphs/", mode: "insensitive" } },
      ],
    });
    expect(JSON.stringify(clause)).not.toContain('"/graphs"');
  });

  test("literal prefixes and resolved paths OR together", () => {
    const [clause] = extra(toPrismaWhere(pq({ in: ["/dsa", "graphs"] }), ["/systems/graphs"]));
    expect(clause?.OR).toHaveLength(4);
  });

  test("resolved paths scope a query that never said in:", () => {
    expect(extra(toPrismaWhere(pq(), ["/dsa"]))).toHaveLength(1);
  });

  test("the same path twice is one scope", () => {
    const [clause] = extra(toPrismaWhere(pq({ in: ["/dsa"] }), ["/dsa/"]));
    expect(clause?.OR).toHaveLength(2);
  });
});

describe("toPrismaWhere · is: and its negation", () => {
  test("is:solid pins the confidence", () => {
    expect(inner(extra(toPrismaWhere(pq({ is: ["solid"] })))[0])).toEqual({ confidence: 4 });
  });

  test("-is:solid returns the unrated and the unanswered too", () => {
    const [clause] = extra(toPrismaWhere(pq({ notIs: ["solid"] })));
    expect(clause).toEqual(complementOf({ confidence: 4 }));
    expect(clause?.OR?.[0]).toEqual({ answer: { is: null } });
  });

  test("is:empty and has:answer are exact opposites", () => {
    const answered = extra(toPrismaWhere(pq({ has: ["answer"] })))[0];
    const empty = extra(toPrismaWhere(pq({ is: ["empty"] })))[0];
    expect(answered).toEqual({ answer: { is: { body: { not: "" } } } });
    expect(empty).toEqual(complementOf(inner(answered)));
  });

  test("-is:empty is has:answer", () => {
    expect(extra(toPrismaWhere(pq({ notIs: ["empty"] })))).toEqual(extra(toPrismaWhere(pq({ has: ["answer"] }))));
  });

  test("is:untagged and has:tag are exact opposites", () => {
    const tagged = extra(toPrismaWhere(pq({ has: ["tag"] })))[0];
    expect(tagged).toEqual({ answer: { is: { tags: { isEmpty: false } } } });
    expect(extra(toPrismaWhere(pq({ is: ["untagged"] })))[0]).toEqual(complementOf(inner(tagged)));
  });

  test("is:never and is:revised are exact opposites", () => {
    const revised = extra(toPrismaWhere(pq({ is: ["revised"] })))[0];
    expect(revised).toEqual({ answer: { is: { lastRevisedAt: { not: null } } } });
    expect(extra(toPrismaWhere(pq({ is: ["never"] })))[0]).toEqual(complementOf(inner(revised)));
  });

  test("an is: word the parser never emits is ignored rather than guessed at", () => {
    expect(extra(toPrismaWhere(pq({ is: ["nonsense"] })))).toEqual([]);
  });
});

describe("toPrismaWhere · conf: and has:", () => {
  test("conf:<=2 compiles to lte", () => {
    expect(inner(extra(toPrismaWhere(pq({ conf: [{ op: "<=", v: 2 }] })))[0])).toEqual({
      confidence: { lte: 2 },
    });
  });

  test("conf:=4 compiles to equality", () => {
    expect(inner(extra(toPrismaWhere(pq({ conf: [{ op: "=", v: 4 }] })))[0])).toEqual({ confidence: 4 });
  });

  test("every comparison has an operator of its own", () => {
    const ops: ParsedQuery["conf"] = [
      { op: ">", v: 0 },
      { op: "<", v: 4 },
      { op: ">=", v: 1 },
    ];
    expect(extra(toPrismaWhere(pq({ conf: ops }))).map(inner)).toEqual([
      { confidence: { gt: 0 } },
      { confidence: { lt: 4 } },
      { confidence: { gte: 1 } },
    ]);
  });

  test("has:code looks for a fence", () => {
    expect(inner(extra(toPrismaWhere(pq({ has: ["code"] })))[0])).toEqual({ body: { contains: "```" } });
  });

  test("an unknown has: word is ignored", () => {
    expect(extra(toPrismaWhere(pq({ has: ["diagram"] })))).toEqual([]);
  });

  test("a comparison an unanswered question satisfies reaches it", () => {
    const [clause] = extra(toPrismaWhere(pq({ conf: [{ op: "<=", v: 2 }] })));
    expect(clause?.OR?.[0]).toEqual({ answer: { is: null } });
  });

  test("a comparison it does not satisfy still requires an answer row", () => {
    const [clause] = extra(toPrismaWhere(pq({ conf: [{ op: ">", v: 2 }] })));
    expect(clause?.OR).toBeUndefined();
    expect(clause).toEqual({ answer: { is: { confidence: { gt: 2 } } } });
  });

  test("is:unrated reaches the unanswered and -is:unrated does not", () => {
    expect(extra(toPrismaWhere(pq({ is: ["unrated"] })))[0]?.OR?.[0]).toEqual({ answer: { is: null } });
    expect(extra(toPrismaWhere(pq({ notIs: ["unrated"] })))[0]).toEqual({
      answer: { is: { NOT: { confidence: 0 } } },
    });
  });

  test("a rated is: word is not reached by the unanswered", () => {
    expect(extra(toPrismaWhere(pq({ is: ["solid"] })))[0]?.OR).toBeUndefined();
  });

  test("everything ANDs — a loaded query keeps one clause per term", () => {
    const w = toPrismaWhere(
      pq({ text: ["dijkstra"], tags: ["graphs"], is: ["never"], conf: [{ op: "<=", v: 2 }], has: ["code"], in: ["/dsa"] }),
      [],
    );
    expect(clauses(w)).toHaveLength(8);
  });
});
