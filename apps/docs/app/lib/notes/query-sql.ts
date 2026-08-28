import type { Prisma } from "db";
import { CONF_NAME, type ParsedQuery } from "./query";

type NodeWhere = Prisma.NoteNodeWhereInput;
type AnswerWhere = Prisma.NoteAnswerWhereInput;

export function toPrismaWhere(q: ParsedQuery, extraInPaths: string[] = []): Prisma.NoteNodeWhereInput {
  const AND: NodeWhere[] = [
    { kind: "QUESTION" },
    q.is.includes("trashed") ? { deletedAt: { not: null } } : { deletedAt: null },
  ];

  for (const w of [...q.text, ...q.phrases]) {
    AND.push({
      OR: [
        { title: { contains: w, mode: "insensitive" } },
        has({ body: { contains: w, mode: "insensitive" } }),
        has({ tags: { hasSome: casings(w) } }),
      ],
    });
  }

  for (const t of q.tags) AND.push(clause(tagWord(t)));
  for (const t of q.notTags) AND.push(clause(not(tagWord(t))));

  if (q.in.length || extraInPaths.length) {
    const scopes = unique([...q.in.filter((f) => f.startsWith("/")).map(prefix), ...extraInPaths.map(prefix)]);
    AND.push(scopes.length ? { OR: scopes.flatMap(subtree) } : NOTHING);
  }

  for (const k of q.is) {
    const w = isWord(k);
    if (w) AND.push(clause(w));
  }
  for (const k of q.notIs) {
    const w = isWord(k);
    if (w) AND.push(clause(not(w)));
  }

  for (const c of q.conf) AND.push(clause(confWord(c)));

  if (q.has.includes("code")) AND.push(clause(CODE));
  if (q.has.includes("answer")) AND.push(clause(not(EMPTY)));
  if (q.has.includes("tag")) AND.push(clause(not(UNTAGGED)));

  return { AND };
}

interface Word {
  f: AnswerWhere;
  want: boolean;
  blank: boolean;
}

function not(w: Word): Word {
  return { f: w.f, want: !w.want, blank: !w.blank };
}

function has(f: AnswerWhere): NodeWhere {
  return { answer: { is: f } };
}

// not the same as !has(f)
function differs(f: AnswerWhere): NodeWhere {
  return { answer: { is: { NOT: f } } };
}

const UNANSWERED: NodeWhere = { answer: { is: null } };

function clause(w: Word): NodeWhere {
  const written = w.want ? has(w.f) : differs(w.f);
  return w.blank ? { OR: [UNANSWERED, written] } : written;
}

const BLANK_CONF = 0;

const EMPTY: Word = { f: { body: { not: "" } }, want: false, blank: true };
const UNTAGGED: Word = { f: { tags: { isEmpty: false } }, want: false, blank: true };
const NEVER: Word = { f: { lastRevisedAt: { not: null } }, want: false, blank: true };
const CODE: Word = { f: { body: { contains: "```" } }, want: true, blank: false };

const NOTHING: NodeWhere = { id: { in: [] } };

function isWord(word: string): Word | null {
  const c = CONF_NAME[word];
  if (c !== undefined) return { f: { confidence: c }, want: true, blank: c === BLANK_CONF };
  if (word === "empty") return EMPTY;
  if (word === "untagged") return UNTAGGED;
  if (word === "never") return NEVER;
  if (word === "revised") return not(NEVER);
  return null;
}

function confWord(c: ParsedQuery["conf"][number]): Word {
  const v = c.v;
  switch (c.op) {
    case "=":
      return { f: { confidence: v }, want: true, blank: BLANK_CONF === v };
    case ">":
      return { f: { confidence: { gt: v } }, want: true, blank: BLANK_CONF > v };
    case "<":
      return { f: { confidence: { lt: v } }, want: true, blank: BLANK_CONF < v };
    case ">=":
      return { f: { confidence: { gte: v } }, want: true, blank: BLANK_CONF >= v };
    case "<=":
      return { f: { confidence: { lte: v } }, want: true, blank: BLANK_CONF <= v };
  }
}

function tagWord(t: string): Word {
  return { f: { tags: { hasSome: casings(t) } }, want: true, blank: false };
}

function prefix(p: string): string {
  const t = p.trim().replace(/\/+$/, "");
  if (!t) return "";
  return t.startsWith("/") ? t : `/${t}`;
}

// the trailing slash keeps /dsa from matching /dsa-archive
function subtree(p: string): NodeWhere[] {
  if (!p) return [{ path: { startsWith: "/" } }];
  return [
    { path: { equals: p, mode: "insensitive" } },
    { path: { startsWith: `${p}/`, mode: "insensitive" } },
  ];
}

// postgres array containment is case sensitive
function casings(t: string): string[] {
  const lower = t.toLowerCase();
  return unique([t, lower, t.toUpperCase(), lower.charAt(0).toUpperCase() + lower.slice(1)]);
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
