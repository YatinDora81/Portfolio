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
  raw: string;
  bad: string[];
}

export interface Matchable {
  title: string;
  path: string;
  deletedAt: Date | string | null;
  body: string;
  tags: string[];
  confidence: number;
  lastRevisedAt: Date | string | null;
  ancestorTitles?: string[];
}

export const CONF_LABELS = ["unrated", "again", "shaky", "good", "solid"] as const;

export const confLabel = (c: number) => CONF_LABELS[Math.max(0, Math.min(4, c))]!;

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

const HAS_WORDS = ["code", "tag", "answer"] as const;

export const QUICK_FILTERS = [
  { label: "Needs revision", q: "conf:<=2" },
  { label: "Never revised", q: "is:never" },
  { label: "Untagged", q: "is:untagged" },
  { label: "No answer yet", q: "is:empty" },
  { label: "Has code", q: "has:code" },
  { label: "Solid", q: "is:solid" },
] as const;

// quoted runs survive as one token
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

export function isEmptyQuery(q: ParsedQuery): boolean {
  return (
    !q.text.length && !q.phrases.length && !q.tags.length && !q.notTags.length &&
    !q.in.length && !q.is.length && !q.notIs.length && !q.conf.length && !q.has.length
  );
}

export function matchQuestion(n: Matchable, q: ParsedQuery): boolean {
  const wantsTrash = q.is.includes("trashed");
  if (!!n.deletedAt !== wantsTrash) return false;

  const title = n.title.toLowerCase();
  const body = n.body.toLowerCase();
  const tags = n.tags.map((t) => t.toLowerCase());

  const word = (w: string) => title.includes(w) || body.includes(w) || tags.includes(w);
  for (const w of q.text) if (!word(w)) return false;
  for (const p of q.phrases) if (!word(p)) return false;

  for (const t of q.tags) if (!tags.includes(t)) return false;
  for (const t of q.notTags) if (tags.includes(t)) return false;

  if (q.in.length) {
    const p = n.path.toLowerCase();
    const titles = (n.ancestorTitles ?? []).map((t) => t.toLowerCase());
    // the separator belongs to the prefix, not /dsa-archive
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

export function matchFolder(
  n: { title: string; deletedAt: Date | string | null },
  q: ParsedQuery
): boolean {
  if (n.deletedAt || q.tags.length || q.conf.length || q.is.length || q.has.length) return false;
  if (!q.text.length && !q.phrases.length) return false;
  const t = n.title.toLowerCase();
  return [...q.text, ...q.phrases].every((w) => t.includes(w));
}

export function terms(q: ParsedQuery): string[] {
  return [...q.text, ...q.phrases].filter((t) => t.length > 1);
}

const SNIPPET_LEN = 165;
const SNIPPET_LEAD = 45;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
