/**
 * The notes query language: one parser and one matcher.
 *
 * The tree filter runs this over rows already in the browser, the palette runs
 * it over its own slice, and the search page compiles the same parse down to a
 * Prisma `where` in query-sql.ts. All three read this file, so `conf:<=2` can
 * only ever mean one thing. A syntax that quietly works in one box and not in
 * the next is worse than no syntax at all.
 *
 * Postgres equivalents, for the half of this that runs server-side. The matcher
 * below is written to produce the same answer as each of them, which is why it
 * is less forgiving in places than an in-memory filter could afford to be:
 *   free text  → contains over title, or over body, or a whole tag
 *   tag:x      → tags @> ARRAY['x']  · GIN on the text[] column, whole values only
 *   in:/a/b    → path = '/a/b' OR path LIKE '/a/b/%'  · btree on path
 *   is: conf:  → btree on confidence / lastRevisedAt, with no answer row read as 0
 */

export interface ParsedQuery {
  text: string[];
  phrases: string[];
  tags: string[];
  notTags: string[];
  in: string[];
  is: string[];
  notIs: string[];
  conf: { op: "=" | ">" | "<" | ">=" | "<="; v: number }[];
  has: string[];
  /** What the user actually typed, kept verbatim so the input can round-trip. */
  raw: string;
  /**
   * Tokens that looked like filters but named nothing real. The UI shows these.
   * The tempting alternative — drop them and match nothing — is exactly the
   * failure mode that makes people decide search is broken.
   */
  bad: string[];
}

/**
 * Everything the matcher needs about one question, flattened by the caller.
 * Deliberately not the Prisma row: the tree filter holds a projection, the
 * palette holds another, and neither should have to shape-shift to be searched.
 */
export interface Matchable {
  title: string;
  path: string;
  deletedAt: Date | string | null;
  body: string;
  tags: string[];
  confidence: number;
  lastRevisedAt: Date | string | null;
  /**
   * Titles of the folders above this node, root first, excluding the node
   * itself. Only `in:` reads it, and only to accept a bare folder name; when the
   * caller has not loaded ancestors, `in:` falls back to path-prefix matching.
   */
  ancestorTitles?: string[];
}

/** The confidence scale. The index *is* the stored integer, so order is data. */
export const CONF_LABELS = ["unrated", "again", "shaky", "good", "solid"] as const;

/** Derived, never typed twice — the parser and the UI cannot drift apart. */
export const CONF_NAME: Record<string, number> = Object.fromEntries(
  CONF_LABELS.map((l, i) => [l, i] as const)
);

export const IS_WORDS = [
  ...CONF_LABELS,
  "untagged",
  "empty",
  "trashed",
  "revised",
  "never",
] as const;

/** The three `has:` facts a question can carry. Anything else is a typo. */
const HAS_WORDS = ["code", "tag", "answer"] as const;

/**
 * The shortcut row under the search box. Each one is written in the syntax a
 * user would type, so clicking a chip and typing it are the same query — and the
 * UI can tell whether a chip is active by looking for `q` inside the raw string.
 */
export const QUICK_FILTERS = [
  { label: "Needs revision", q: "conf:<=2" },
  { label: "Never revised", q: "is:never" },
  { label: "Untagged", q: "is:untagged" },
  { label: "No answer yet", q: "is:empty" },
  { label: "Has code", q: "has:code" },
  { label: "Solid", q: "is:solid" },
] as const;

/** Quoted runs survive as one token, so `tag:"machine learning"` stays whole. */
const TOKENS = /(?:[^\s"]+|"[^"]*")+/g;
const CONF_TERM = /^(>=|<=|>|<|=)?(\d|unrated|again|shaky|good|solid)$/;

export function parseQuery(s: string): ParsedQuery {
  const q: ParsedQuery = {
    text: [], phrases: [], tags: [], notTags: [], in: [],
    is: [], notIs: [], conf: [], has: [], raw: s, bad: [],
  };

  for (let raw of String(s).match(TOKENS) ?? []) {
    let neg = false;
    if (raw[0] === "-" && raw.length > 1) {
      neg = true;
      raw = raw.slice(1);
    }
    if (raw[0] === "#") {
      (neg ? q.notTags : q.tags).push(raw.slice(1).toLowerCase());
      continue;
    }

    const m = raw.match(/^(\w+):(.*)$/);
    if (m) {
      const key = m[1]!.toLowerCase();
      const val = m[2]!.replace(/^"|"$/g, "").toLowerCase();

      // An unknown key is reported before the empty check, because "banana:" is
      // a typo whether or not a value follows it. A *known* key with no value is
      // not: "tag:" is a keystroke on the way to "tag:redis", and complaining
      // about it would flash the box red on every other character.
      switch (key) {
        case "tag":
          if (val) (neg ? q.notTags : q.tags).push(val);
          continue;
        case "in":
        case "folder":
          if (val) q.in.push(val);
          continue;
        case "has":
          if (!val) continue;
          if (!(HAS_WORDS as readonly string[]).includes(val)) q.bad.push("has:" + val);
          else q.has.push(val);
          continue;
        case "is":
          if (!val) continue;
          if (!(IS_WORDS as readonly string[]).includes(val)) q.bad.push("is:" + val);
          else (neg ? q.notIs : q.is).push(val);
          continue;
        case "conf": {
          if (!val) continue;
          const c = val.match(CONF_TERM);
          if (!c) {
            q.bad.push("conf:" + val);
            continue;
          }
          const name = c[2]!;
          q.conf.push({
            op: (c[1] ?? "=") as ParsedQuery["conf"][number]["op"],
            v: CONF_NAME[name] ?? Number(name),
          });
          continue;
        }
        default:
          q.bad.push(key + ":");
          continue;
      }
    }

    if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 2) {
      q.phrases.push(raw.slice(1, -1).toLowerCase());
      continue;
    }
    q.text.push(raw.replace(/"/g, "").toLowerCase());
  }

  return q;
}

/**
 * True when nothing was asked for. `bad` is not consulted on purpose: a query of
 * only typos still has to render as "no filters", or the results list would
 * silently swap to empty while the error line explains why.
 */
export function isEmptyQuery(q: ParsedQuery): boolean {
  return (
    !q.text.length && !q.phrases.length && !q.tags.length && !q.notTags.length &&
    !q.in.length && !q.is.length && !q.notIs.length && !q.conf.length && !q.has.length
  );
}

export function matchQuestion(n: Matchable, q: ParsedQuery): boolean {
  // Trash is a separate room, not a filter you can forget to apply. Deleted rows
  // appear for `is:trashed` and for nothing else.
  const wantsTrash = q.is.includes("trashed");
  if (!!n.deletedAt !== wantsTrash) return false;

  const title = n.title.toLowerCase();
  const body = n.body.toLowerCase();
  const tags = n.tags.map((t) => t.toLowerCase());

  // Field by field, not over one concatenated haystack. The server compiles each
  // word to `title contains OR body contains OR tags has`, and a haystack has a
  // seam the OR does not: a phrase whose first half ends the title and whose
  // second half opens the body would match here and nowhere else.
  const word = (w: string) => title.includes(w) || body.includes(w) || tags.includes(w);
  for (const w of q.text) if (!word(w)) return false;
  for (const p of q.phrases) if (!word(p)) return false;

  // Tags compare whole rather than by substring. Postgres array containment is
  // the only tag test that keeps the GIN index in play, so letting "auth" find
  // "authorization" here would be a hit the search page cannot return — and a
  // filter that works in the tree and not in search is worse than one that never
  // worked. `normaliseTags` folds tags to lowercase on write, which is what
  // makes comparing against the parser's lowercased term the right test.
  for (const t of q.tags) if (!tags.includes(t)) return false;
  for (const t of q.notTags) if (tags.includes(t)) return false;

  if (q.in.length) {
    const p = n.path.toLowerCase();
    const titles = (n.ancestorTitles ?? []).map((t) => t.toLowerCase());
    // The separator belongs to the prefix: a bare startsWith("/dsa") also claims
    // the sibling /dsa-archive. `subtree` in query-sql.ts spells the same rule
    // out as `path = p OR path LIKE p || '/%'`.
    const under = (f: string) => {
      const scope = f.replace(/\/+$/, "");
      return p === scope || p.startsWith(scope + "/");
    };
    const inScope = q.in.some((f) =>
      f.startsWith("/") ? under(f) : under("/" + f) || titles.some((x) => x.includes(f))
    );
    if (!inScope) return false;
  }

  const test = (k: string): boolean => {
    if (CONF_NAME[k] !== undefined) return n.confidence === CONF_NAME[k];
    if (k === "untagged") return tags.length === 0;
    // Emptiness is the stored empty string, not a trimmed one: `where` cannot
    // call trim(), so the server can only ask `body <> ''`. Keeping whitespace
    // out of the column is the save path's job — trim there and the two
    // readings can never come apart.
    if (k === "empty") return n.body === "";
    if (k === "revised") return !!n.lastRevisedAt;
    if (k === "never") return !n.lastRevisedAt;
    if (k === "trashed") return !!n.deletedAt;
    return true;
  };
  for (const k of q.is) if (!test(k)) return false;
  for (const k of q.notIs) if (test(k)) return false;

  for (const c of q.conf) {
    const v = n.confidence;
    if (c.op === "=" && v !== c.v) return false;
    if (c.op === ">" && !(v > c.v)) return false;
    if (c.op === "<" && !(v < c.v)) return false;
    if (c.op === ">=" && !(v >= c.v)) return false;
    if (c.op === "<=" && !(v <= c.v)) return false;
  }

  for (const h of q.has) {
    if (h === "code" && !n.body.includes("```")) return false;
    if (h === "tag" && !tags.length) return false;
    if (h === "answer" && n.body === "") return false;
  }
  return true;
}

/**
 * Folders match on their own name and nothing else. A folder is never a search
 * hit, it is context for one, so any filter that describes an *answer* —
 * tags, confidence, is:, has: — disqualifies the whole folder side of the
 * result set rather than being ignored on it.
 */
export function matchFolder(
  n: { title: string; deletedAt: Date | string | null },
  q: ParsedQuery
): boolean {
  if (n.deletedAt || q.tags.length || q.conf.length || q.is.length || q.has.length) return false;
  if (!q.text.length && !q.phrases.length) return false;
  const t = n.title.toLowerCase();
  return [...q.text, ...q.phrases].every((w) => t.includes(w));
}

/** The words worth painting. One character would light up half the page. */
export function terms(q: ParsedQuery): string[] {
  return [...q.text, ...q.phrases].filter((t) => t.length > 1);
}

const SNIPPET_LEN = 165;
/** How much context to keep in front of the first hit, so it lands mid-line. */
const SNIPPET_LEAD = 45;

/** Search terms are user input; `c++` or `a|b` would not survive as a pattern. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits `text` into ordered runs, marking the ones a term matched. Callers
 * render these as `<span>` / `<mark>`.
 *
 * The segment array exists so React never sees `dangerouslySetInnerHTML` for a
 * note's own words. It also removes two bugs that a highlight-by-string-replace
 * cannot avoid: HTML-escaping the text first stops a term containing `&` or `<`
 * from ever matching, and each pass can match inside the markup the previous
 * pass injected. Here every term is matched against the original text and the
 * resulting ranges are merged, so overlapping terms produce one run, not nested
 * ones.
 */
export function highlightParts(text: string, ts: string[]): { text: string; hit: boolean }[] {
  if (!text) return [];

  const ranges: [number, number][] = [];
  for (const t of ts) {
    if (!t) continue;
    const re = new RegExp(escapeRe(t), "gi");
    for (let m = re.exec(text); m; m = re.exec(text)) ranges.push([m.index, m.index + m[0].length]);
  }
  if (!ranges.length) return [{ text, hit: false }];

  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  let [s, e] = ranges[0]!;
  for (const r of ranges.slice(1)) {
    if (r[0] <= e) {
      e = Math.max(e, r[1]);
      continue;
    }
    if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    cursor = e;
    [s, e] = r;
  }
  if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
  out.push({ text: text.slice(s, e), hit: true });
  if (e < text.length) out.push({ text: text.slice(e), hit: false });
  return out;
}

/**
 * A one-line preview of an answer, centred on the first term that appears in it.
 *
 * Fenced blocks collapse to a `[code]` marker rather than being dumped into a
 * single line — a result row is a place to recognise a note, not to read its
 * source. Ellipses appear only on a side that was actually cut.
 */
export function snippetParts(body: string, q: ParsedQuery): { text: string; hit: boolean }[] {
  const flat = body
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/[`\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return [];

  const ts = terms(q);
  const lower = flat.toLowerCase();
  let i = -1;
  for (const t of ts) {
    const k = lower.indexOf(t);
    if (k > -1) {
      i = k;
      break;
    }
  }

  const start = i > -1 ? Math.max(0, i - SNIPPET_LEAD) : 0;
  const parts = highlightParts(flat.slice(start, start + SNIPPET_LEN), ts);
  if (start) parts.unshift({ text: "…", hit: false });
  if (start + SNIPPET_LEN < flat.length) parts.push({ text: "…", hit: false });
  return parts;
}
