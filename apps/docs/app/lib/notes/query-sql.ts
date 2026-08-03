import type { Prisma } from "db";
import { CONF_NAME, type ParsedQuery } from "./query";

type NodeWhere = Prisma.NoteNodeWhereInput;
type AnswerWhere = Prisma.NoteAnswerWhereInput;

/**
 * The server half of the query language: one `ParsedQuery` in, one Prisma
 * `where` out, so the search page and the client-side tree filter answer to the
 * same parse and a query means the same thing wherever it is typed.
 *
 * Three things here are not obvious and are worth stating once:
 *
 * 1. **`answer` is a nullable one-to-one, and a question without one is not a
 *    question without properties.** Every read in the app takes
 *    `answer?.confidence ?? 0`, and the client matcher filters against that
 *    flattened zero, so an unanswered question *is* unrated, *is* empty, *is*
 *    untagged and *was* never revised. A predicate true of that blank answer has
 *    to admit the missing row explicitly, which is what `Word.blank` records and
 *    `clause` writes out. Leaving it implicit is how `conf:<=2` — the "Needs
 *    revision" chip — ends up hiding the questions nobody has answered at all.
 *    The same branch is what makes `NOT` safe: written the naive way,
 *    `NOT: { answer: { confidence: 4 } }` reads as "no answer row of confidence 4
 *    exists", which is also true of a question with no answer row, and false-ish
 *    in ways that shift between Prisma versions.
 * 2. **`in:` by folder name cannot be resolved here.** A bare `in:graphs` names a
 *    folder anywhere in the tree; finding it is a query, and this function does
 *    not have a client. The caller resolves names to paths and passes them as
 *    `extraInPaths`; only `in:/dsa`-style terms are read as literal prefixes.
 *    When a scope was asked for and nothing resolved, the result is empty — the
 *    tempting fallback of "no prefixes, so do not filter" widens a scoped search
 *    to the whole vault and looks like success.
 * 3. **Tags are a Postgres `text[]`.** Containment is by whole value and case
 *    sensitive, and Prisma's scalar list filters take no `mode`. That is a limit
 *    the client matcher observes too: neither side matches a tag by substring,
 *    because a filter that finds "authorization" in the tree and not in search
 *    is worse than one that never found it. See `casings`.
 */
export function toPrismaWhere(q: ParsedQuery, extraInPaths: string[] = []): Prisma.NoteNodeWhereInput {
  const AND: NodeWhere[] = [
    { kind: "QUESTION" },
    // The vault is live-only until `is:trashed` says otherwise. `trashed` is not
    // a property of the answer row, so it never reaches `isFilter` below.
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

/**
 * One question a query can ask of an answer: the filter, whether the word
 * asserts it or its negation, and whether a question with no answer row at all
 * satisfies the word. `blank` is the whole reason this is a record rather than a
 * bare `AnswerWhere` — see note 1 at the top.
 */
interface Word {
  f: AnswerWhere;
  want: boolean;
  blank: boolean;
}

/**
 * The negation of a word, which is also its opposite word. Building
 * `has:answer` as `not(EMPTY)` rather than as its own filter is what keeps the
 * pairs exact: there is one filter per fact, read forwards or backwards, so no
 * edit can make `is:empty` and `has:answer` both true of the same question.
 */
function not(w: Word): Word {
  return { f: w.f, want: !w.want, blank: !w.blank };
}

/** The answer row exists and matches. */
function has(f: AnswerWhere): NodeWhere {
  return { answer: { is: f } };
}

/** The answer row exists and does not match. Note that this is *not* `!has(f)`. */
function differs(f: AnswerWhere): NodeWhere {
  return { answer: { is: { NOT: f } } };
}

/** No answer row — which is a state a question can be in, not an absence of one. */
const UNANSWERED: NodeWhere = { answer: { is: null } };

function clause(w: Word): NodeWhere {
  const written = w.want ? has(w.f) : differs(w.f);
  return w.blank ? { OR: [UNANSWERED, written] } : written;
}

/** What an unanswered question's confidence reads as everywhere else in the app. */
const BLANK_CONF = 0;

/** A written answer, so `is:empty` is its negation and `has:answer` is not. */
const EMPTY: Word = { f: { body: { not: "" } }, want: false, blank: true };
/** At least one tag. */
const UNTAGGED: Word = { f: { tags: { isEmpty: false } }, want: false, blank: true };
/** Seen at least once in the revise queue. */
const NEVER: Word = { f: { lastRevisedAt: { not: null } }, want: false, blank: true };
/** A fenced block. Case is irrelevant to backticks, so no `mode` here. */
const CODE: Word = { f: { body: { contains: "```" } }, want: true, blank: false };

/** Matches nothing, and says so in the plan rather than by returning no rows by luck. */
const NOTHING: NodeWhere = { id: { in: [] } };

/**
 * Each `is:` word, or null for one this file does not speak for.
 *
 * `trashed` is deliberately absent — it filters `deletedAt` on the node, and
 * returning a word for it here would also apply it as an answer predicate.
 */
function isWord(word: string): Word | null {
  const c = CONF_NAME[word];
  if (c !== undefined) return { f: { confidence: c }, want: true, blank: c === BLANK_CONF };
  if (word === "empty") return EMPTY;
  if (word === "untagged") return UNTAGGED;
  if (word === "never") return NEVER;
  if (word === "revised") return not(NEVER);
  return null;
}

/**
 * Written out per operator twice over: once as a filter, and once as what the
 * operator says about a blank answer. A computed key would widen to
 * `Record<string, number>` and stop typechecking, and a Prisma filter object
 * cannot be evaluated after the fact — so the two readings sit on one line each,
 * where they can be seen to agree.
 */
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

/** A tag the answer carries. Whole values only — see `casings`. */
function tagWord(t: string): Word {
  return { f: { tags: { hasSome: casings(t) } }, want: true, blank: false };
}

/** Leading slash, no trailing one, so `/dsa` and `/dsa/` describe the same subtree. */
function prefix(p: string): string {
  const t = p.trim().replace(/\/+$/, "");
  if (!t) return "";
  return t.startsWith("/") ? t : `/${t}`;
}

/**
 * A subtree is the folder's own path plus everything under it. The separator is
 * part of the prefix on purpose: a bare `startsWith("/dsa")` also swallows
 * `/dsa-archive`, which is a neighbour, not a child.
 */
function subtree(p: string): NodeWhere[] {
  if (!p) return [{ path: { startsWith: "/" } }];
  return [
    { path: { equals: p, mode: "insensitive" } },
    { path: { startsWith: `${p}/`, mode: "insensitive" } },
  ];
}

/**
 * The casings a tag might plausibly be stored in. `parseQuery` lowercases every
 * term, so without this `tag:redis` misses a tag saved as `Redis` — Postgres
 * array containment compares the text exactly, and `LOWER(tags)` would give up
 * the GIN index.
 *
 * `normaliseTags` folds tags on write, so this should never actually be needed;
 * it stays as the cheap half of a belt and braces, since a row that arrives from
 * anywhere but `saveAnswer` would otherwise be unfindable by its own tag. Drop
 * it to a single `has: t` the day that write path is the only one there is.
 */
function casings(t: string): string[] {
  const lower = t.toLowerCase();
  return unique([t, lower, t.toUpperCase(), lower.charAt(0).toUpperCase() + lower.slice(1)]);
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
