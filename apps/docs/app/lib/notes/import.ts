import { z } from "zod";
import { VAULT_FORMAT, VAULT_VERSION } from "./export";
import { normaliseTags, slugify, type NoteKind } from "./paths";
import { CONF_NAME } from "./query";

/**
 * The other half of export.ts: turning a pasted file back into notes.
 *
 * Two shapes arrive here and exactly one leaves. The **vault** shape is the
 * `vaultJson()` this app already emits — every column, ids and all — and it
 * exists so a vault can round-trip. The **nested** shape is folders containing
 * folders containing questions with no ids anywhere, and it exists because the
 * thing people actually want to paste is an outline they wrote by hand or had a
 * model generate. `flattenNested` walks the second into the first, and from
 * `parseImport` onwards nothing downstream knows which one arrived.
 *
 * Pure by design — no Prisma, and nothing that reaches for a request. That is
 * not tidiness: the import dialog runs this module in the browser to preview a
 * paste before anything is written, so the counts the user is shown and the tree
 * the transaction builds are decided by the same code. The moment `db` is
 * imported here, the Prisma client is dragged into the client bundle and the
 * build breaks — `audit.ts` is split from `audit-writer.ts` for the same reason.
 *
 * What this file will NOT do is decide what is already in the database. Slugs,
 * paths, depths and sibling order are all recomputed by `importIn` against the
 * live tree, because a graft re-parents the file's roots and that invalidates
 * every path beneath them. Read `vaultJson`'s doc comment in export.ts: it
 * specifies the contract this file implements.
 */

/** A refusal the user is meant to read. Distinct from `NoteError`, which lives
 *  in core.ts and cannot be imported here — core.ts imports Prisma. */
export class ImportError extends Error {}

/**
 * Also the ceiling that keeps a level's insert inside Postgres' 65535 bind
 * parameters: seven columns a row, so even a file that is 5,000 roots and
 * nothing else is one statement of 35,000 placeholders. Raising this past
 * ~9,000 would break the widest level and nothing else, which is the worst
 * possible way for it to break.
 */
export const MAX_NODES = 5_000;
/** Chars, per node. One 400 MB body is as effective a denial of service as
 *  400 MB of nodes, and only a per-node cap catches it. */
export const MAX_BODY = 200_000;
/** Chars, per tag. `normaliseTags` caps how MANY tags a note keeps and says
 *  nothing about how long one may be — and every one of them lands in a GIN
 *  index. Forty tags of 200 KB is the same attack as one enormous body. */
export const MAX_TAG = 64;
/**
 * Bytes of JSON. Must stay BELOW `experimental.serverActions.bodySizeLimit` in
 * next.config.js: Next answers 413 on its own past that, before the action can
 * say anything more useful than "it failed".
 */
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
/**
 * Deeper than any usable outline, and shallow enough that `rebuildSubtree`'s
 * recursive walk cannot blow the stack.
 *
 * That second half is the load-bearing one. `rebuildSubtree` recurses over
 * `childrenOf`, so a pathologically deep tree would raise a `RangeError` AFTER
 * every row had been inserted — inside the transaction, so nothing is left
 * behind, but the user is shown a stack overflow instead of a sentence. The cap
 * therefore lives in the importer, where the refusal can happen before the first
 * write, rather than being left to the database to discover.
 */
export const MAX_DEPTH = 32;

export type ImportMode = "into" | "restore";

/**
 * What an incoming folder does when the destination already holds one by that
 * name: land inside it, or become a second folder beside it.
 *
 * `create` is what this importer always did. It is kept rather than replaced
 * because it is the only honest answer for a file you want kept whole and
 * separate — and because `uniqueSlug` already makes it work, it costs nothing
 * to keep offering.
 */
export type FolderMode = "merge" | "create";
export type Shape = "vault" | "nested";

export const SHAPE_LABEL: Record<Shape, string> = {
  vault: "vault export",
  nested: "nested outline",
};

/* -------------------------------------------------------------- the parts -- */

const title = z.string().trim().min(1, "Title required").max(300, "Title is too long");

/**
 * `["a","b"]` or `"a, b"` — hand-written files and generated ones use both.
 * Normalised here, with the same helper the write uses, so the preview's tag
 * list is literally the list that will be stored.
 *
 * Truncated rather than refused: a 200 KB "tag" is a mistake in the file, not a
 * reason to reject the other four hundred notes with it. Cutting happens before
 * `normaliseTags` so two tags that collide once shortened still de-duplicate.
 */
const tags = z
  .union([z.array(z.string()), z.string()])
  .default([])
  .transform((t) => normaliseTags((typeof t === "string" ? t.split(",") : t).map((x) => x.slice(0, MAX_TAG))));

/**
 * `0`–`4`, or a CONF_LABELS word. Resolved through CONF_NAME rather than a
 * second table, so the scale can never drift from the one the UI shows —
 * `CONF_NAME[name] ?? Number(name)` is the coercion the query language already
 * uses for `conf:solid`, and this is the same sentence in a different file.
 *
 * Anything unrecognised lands on 0 rather than refusing the file. A number out
 * of range has to fall back to something, and a self-rating nobody can parse is
 * exactly what "unrated" means — refusing a 200-note outline over one stray word
 * would be the wrong trade in the other direction.
 */
const confidence = z
  .union([z.number(), z.string()])
  .default(0)
  .transform((c) => (typeof c === "number" ? c : (CONF_NAME[c.trim().toLowerCase()] ?? Number(c))))
  .pipe(z.number().int().min(0).max(4).catch(0));

const body = z.string().max(MAX_BODY, "A note body is too large to import");

/** Only ever a uuid in practice; the class is what stops a hand-edited one from
 *  carrying a path separator into a column that is joined on "/". */
const ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "That file has an id that is not an id");

/* ---------------------------------------------------- Shape A: flat vault -- */

export const VaultNodeSchema = z
  .object({
    // `restore` writes these verbatim, and `tombstone()` later interpolates an
    // id into the UNIQUE path column — so an id holding "/" would forge a path
    // segment. Every id this app writes is a uuid, and the class below is
    // closed under that, so nothing real is turned away by refusing the rest.
    id: ID,
    parentId: ID.nullable(),
    kind: z.enum(["FOLDER", "QUESTION"]),
    title,
    // Accepted so an unmodified export parses, then ignored: every one of these
    // is recomputed downstream from the node's new parentage.
    slug: z.string().optional(),
    path: z.string().optional(),
    depth: z.number().optional(),
    sortOrder: z.number().int().optional(),
    body: body.default(""),
    tags,
    confidence,
    lastRevisedAt: z.coerce
      .date()
      .nullish()
      .transform((d) => d ?? null),
  })
  .strip();

export const VaultSchema = z.object({
  format: z.literal(VAULT_FORMAT),
  version: z.literal(VAULT_VERSION),
  exportedAt: z.string().optional(),
  count: z.number().int().optional(),
  nodes: z.array(VaultNodeSchema).max(MAX_NODES, "That file has too many notes to import at once"),
});

export type VaultNode = z.infer<typeof VaultNodeSchema>;

/* ------------------------------------------------- Shape B: nested outline -- */

/** The authoring shape, as written. Every field but `title` is optional, which
 *  is the whole point: the cheapest legal outline is a list of strings. */
export interface NestedNote {
  title: string;
  kind?: NoteKind;
  body?: string;
  tags?: string[];
  confidence?: number;
  children?: NestedNote[];
}

/**
 * Recursive, so the type is declared up front and `z.lazy` closes the loop.
 *
 * The string branch comes first and is the shorthand: a bare string inside
 * `children` is a question with that title and no body. Order matters — a union
 * returns its first success, and only a string can match branch one.
 */
export const NestedNoteSchema: z.ZodType<NestedNote, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    title.transform((t) => ({ title: t })),
    z
      .object({
        title,
        kind: z.enum(["FOLDER", "QUESTION"]).optional(),
        body: body.optional(),
        tags,
        confidence,
        children: z.array(NestedNoteSchema).optional(),
      })
      .strip(),
  ]),
);

export const NestedSchema = z.union([
  z.array(NestedNoteSchema),
  z
    .object({ version: z.literal(1).optional(), notes: z.array(NestedNoteSchema) })
    .strip()
    .transform((o) => o.notes),
]);

/* ------------------------------------------------------------- detection -- */

/**
 * Which shape arrived, decided before either schema runs so a failure can name
 * the right one. A `nodes` array counts as a vault even without the format
 * string: "your format field is wrong" is a better answer than "unrecognised".
 */
export function detectShape(raw: unknown): Shape | null {
  if (Array.isArray(raw)) return "nested";
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.format === VAULT_FORMAT || Array.isArray(o.nodes)) return "vault";
  if (Array.isArray(o.notes)) return "nested";
  return null;
}

/* ---------------------------------------------------------- flattening B -- */

/**
 * Nested → the flat list the vault shape already produces: a synthetic id per
 * node, `parentId` from the walk, parents before children, and array order as
 * `sortOrder` among siblings.
 *
 * ITERATIVE, with an explicit stack. A recursive walk over untrusted depth is a
 * `RangeError` waiting for a hostile 100k-deep payload, and a stack overflow is
 * not a refusal — it is a crash that happens to have the same outcome. Depth and
 * node count are both checked as the walk runs, so the refusal lands before the
 * list is even built, let alone written.
 *
 * `kind` is inferred here and nowhere else: `children` present — even `[]` —
 * means FOLDER, and an explicit `kind` overrides.
 */
export function flattenNested(notes: NestedNote[]): VaultNode[] {
  interface Frame {
    note: NestedNote;
    parentId: string | null;
    depth: number;
    index: number;
  }

  const out: VaultNode[] = [];
  const stack: Frame[] = [];
  // Pushed in reverse so siblings pop in array order — which is what makes the
  // order somebody wrote the outline in the order it appears in the tree.
  const push = (kids: NestedNote[], parentId: string | null, depth: number) => {
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ note: kids[i]!, parentId, depth, index: i });
  };
  push(notes, null, 1);

  let seq = 0;
  while (stack.length) {
    const { note, parentId, depth, index } = stack.pop()!;
    if (depth > MAX_DEPTH) {
      throw new ImportError(`“${note.title}” is nested more than ${MAX_DEPTH} levels deep — flatten it and try again`);
    }
    if (out.length >= MAX_NODES) {
      throw new ImportError(`That outline has more than ${MAX_NODES} notes in it — import it in pieces`);
    }

    // Local to this list and remapped before it reaches the database, so it only
    // has to be unique among the nodes in the file. Deliberately not a uuid: it
    // must never be mistaken for an id `restore` mode could write.
    const id = `~${++seq}`;
    out.push({
      id,
      parentId,
      kind: note.kind ?? (note.children ? "FOLDER" : "QUESTION"),
      title: note.title,
      sortOrder: index,
      body: note.body ?? "",
      tags: note.tags ?? [],
      confidence: note.confidence ?? 0,
      lastRevisedAt: null,
    });

    if (note.children?.length) push(note.children, id, depth + 1);
  }

  return out;
}

/* ------------------------------------------------------------- structure -- */

interface Structure {
  /** The file's roots, per the rule below. */
  roots: VaultNode[];
  childrenOf: Map<string, VaultNode[]>;
  /** Depth within the file, 1 for a root. Absent for a node inside a cycle. */
  depth: Map<string, number>;
  /** Roots first, then their children, and so on. Never empty levels. */
  levels: VaultNode[][];
  /** Nodes no root can reach, which is exactly the nodes inside a parent cycle. */
  stranded: VaultNode[];
}

/**
 * "Root of the file" is not `parentId === null`.
 *
 * A folder export selects a subtree whose topmost row still points at a parent
 * deliberately left out of the file. Read that pointer literally and the whole
 * import lands on the floor. This is the same predicate `treeOrder()` uses in
 * export.ts, and it is why a nested payload needs no second code path: every
 * top-level entry there has `parentId: null` and satisfies it too.
 */
const isFileRoot = (n: VaultNode, present: Set<string>) =>
  n.parentId === null || !present.has(n.parentId) || n.parentId === n.id;

function structure(nodes: VaultNode[]): Structure {
  const present = new Set(nodes.map((n) => n.id));
  const at = new Map(nodes.map((n, i) => [n.id, i] as const));

  const roots: VaultNode[] = [];
  const childrenOf = new Map<string, VaultNode[]>();
  for (const n of nodes) {
    if (isFileRoot(n, present)) {
      roots.push(n);
      continue;
    }
    const list = childrenOf.get(n.parentId!);
    if (list) list.push(n);
    else childrenOf.set(n.parentId!, [n]);
  }

  // `sortOrder` is only meaningful among siblings, and a vault written before a
  // reindex can have every row sitting on 0. The tie-break is the file's own
  // order, which for an export IS tree order — so a file that never carried
  // useful sort numbers still imports in the order it reads.
  const order = (a: VaultNode, b: VaultNode) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || at.get(a.id)! - at.get(b.id)!;
  roots.sort(order);
  for (const list of childrenOf.values()) list.sort(order);

  const depth = new Map<string, number>();
  const levels: VaultNode[][] = [];
  let level = roots;
  while (level.length) {
    levels.push(level);
    for (const n of level) depth.set(n.id, levels.length);
    const next: VaultNode[] = [];
    for (const n of level) {
      for (const c of childrenOf.get(n.id) ?? []) if (!depth.has(c.id)) next.push(c);
    }
    level = next;
  }

  return { roots, childrenOf, depth, levels, stranded: nodes.filter((n) => !depth.has(n.id)) };
}

/** The file's roots, in the order they will be grafted. */
export function fileRoots(nodes: VaultNode[]): VaultNode[] {
  return structure(nodes).roots;
}

/**
 * The nodes grouped by depth: level 0 is the file's roots, level 1 their
 * children, and so on. `importIn` inserts a level per statement, which is what
 * keeps a thousand-node import from being a thousand round trips — and it is
 * safe for a self-referencing foreign key in a way one big statement is not,
 * because every parent is committed by the statement before.
 */
export function levelOrder(nodes: VaultNode[]): VaultNode[][] {
  return structure(nodes).levels;
}

/**
 * Parents strictly before children. The input order is not assumed — a file that
 * has been hand-edited, sorted or concatenated still comes out insertable.
 *
 * Nodes inside a parent cycle are appended rather than dropped: `vaultProblems`
 * refuses a cycle before anything reaches here, so this is unreachable, and
 * losing a note silently would be the worse of the two ways to be wrong.
 */
export function topoOrder(nodes: VaultNode[]): VaultNode[] {
  const s = structure(nodes);
  return [...s.levels.flat(), ...s.stranded];
}

/* ------------------------------------------------------------- the graft -- */

/** One live row of the destination vault, as the graft needs to see it. */
export interface LiveNode {
  id: string;
  parentId: string | null;
  slug: string;
  kind: NoteKind;
  /** Unused by the plan below, and required anyway: `importIn` seeds each merged
   *  folder's next sort number from it, so the two callers hand over the same
   *  row rather than two different views of one. */
  sortOrder: number;
}

export interface GraftPlan {
  /** File node id → the existing folder it lands *inside of* rather than being
   *  created as. Absent for every node that will be inserted. */
  merged: Map<string, string>;
  foldersReused: number;
  foldersCreated: number;
  questionsCreated: number;
}

/**
 * Which of the file's folders already exist at the destination, and so should be
 * grafted into rather than built again.
 *
 * The decision is here, in the pure half, because two places have to make it and
 * they must never disagree: `importIn` writes it, and the dialog previews it in
 * the browser before anything is written. They call this same function over the
 * same live rows — the preview is not a description of the import, it IS the
 * import's own plan, run early.
 *
 * Three rules, each of which is a decision rather than a detail:
 *
 * **Slug, not title.** The slug is already what a level is unique on, and
 * `slugify` folds away case, spacing and punctuation — so "Dynamic Programming"
 * lands in an existing "dynamic programming" instead of doubling it, which is
 * the whole reason somebody reaches for this.
 *
 * **Folder onto folder only.** A question is never merged into: two notes that
 * share a title are two notes, and treating them as one would mean deciding
 * whose answer survives. The importer does not get to make that call, so a
 * repeated question is created beside the old one and disambiguated by slug.
 * A file folder meeting a live *question* of the same name likewise creates —
 * refusing a four-hundred-note import over one name collision would be the
 * wrong trade in the other direction.
 *
 * **Merging stops where the names stop matching.** A node can only merge if its
 * parent did, so the graft follows the existing tree down as far as it goes and
 * everything past that point is new. That falls out of `merged.has(parentId)`
 * rather than being enforced: once an ancestor is created, nothing beneath it
 * has anything live to collide with.
 *
 * `claimed` is the case worth naming: a file holding two sibling folders both
 * called "Trees" cannot merge both into the one live "Trees" — the second would
 * be trying to occupy a folder the first already took. The first merges, the
 * second is created, and `uniqueSlug` gives it `trees-2`.
 */
export function planGraft(
  nodes: VaultNode[],
  destParentId: string | null,
  live: LiveNode[],
  folders: FolderMode,
): GraftPlan {
  const merged = new Map<string, string>();
  let foldersReused = 0;
  let foldersCreated = 0;
  let questionsCreated = 0;

  const kidsOf = new Map<string | null, LiveNode[]>();
  if (folders === "merge") {
    for (const n of live) {
      const list = kidsOf.get(n.parentId);
      if (list) list.push(n);
      else kidsOf.set(n.parentId, [n]);
    }
  }

  const claimed = new Set<string>();

  for (const [depth, level] of levelOrder(nodes).entries()) {
    for (const n of level) {
      // The vault node this one lands under: the destination for a file root,
      // and otherwise whatever its parent merged into. `undefined` means the
      // parent was created, which is what ends the merge for this branch.
      const host = depth === 0 ? destParentId : merged.get(n.parentId!);
      const mergeable = folders === "merge" && n.kind === "FOLDER" && (depth === 0 || host !== undefined);

      if (mergeable) {
        const want = slugify(n.title);
        const hit = (kidsOf.get(host ?? null) ?? []).find(
          (k) => k.slug === want && k.kind === "FOLDER" && !claimed.has(k.id),
        );
        if (hit) {
          merged.set(n.id, hit.id);
          claimed.add(hit.id);
          foldersReused++;
          continue;
        }
      }

      if (n.kind === "FOLDER") foldersCreated++;
      else questionsCreated++;
    }
  }

  return { merged, foldersReused, foldersCreated, questionsCreated };
}

/* ------------------------------------------------------------ validation -- */

/**
 * Everything that makes a payload un-writable, as messages rather than throws,
 * so one call answers both "may I write this" and "what do I tell the user".
 *
 * The checks are ordered, and the first list that is returned is the answer: a
 * duplicate id makes every structural claim after it meaningless, so there is no
 * point reporting what a corrupt index implies.
 */
export function vaultProblems(nodes: VaultNode[], declaredCount?: number): string[] {
  if (!nodes.length) return ["There are no notes in that file"];
  if (nodes.length > MAX_NODES) {
    return [`That file has ${nodes.length} notes in it — more than the ${MAX_NODES} an import can take at once`];
  }

  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) return [`Two notes in that file share the id ${n.id}`];
    seen.add(n.id);
  }

  const problems: string[] = [];
  if (declaredCount !== undefined && declaredCount !== nodes.length) {
    problems.push(`That file says it holds ${declaredCount} notes but carries ${nodes.length} — it looks truncated`);
  }

  const { childrenOf, levels, stranded } = structure(nodes);

  for (const n of nodes) {
    if (n.kind === "QUESTION" && childrenOf.has(n.id)) {
      problems.push(`“${n.title}” is a question with children — only folders can hold children`);
    }
    if (n.kind === "FOLDER" && n.body.trim()) {
      problems.push(
        childrenOf.has(n.id)
          ? `“${n.title}” has children and an answer body — a folder can't hold an answer`
          : `“${n.title}” is a folder with an answer body — a folder can't hold an answer`,
      );
    }
  }

  // A cycle survives `buildTree`, which promotes the row to a root and renders
  // it. It does not survive an insert pass, which would loop forever looking for
  // a parent to hang it on, so it is refused here rather than defended against
  // downstream.
  if (stranded.length) {
    problems.push(`“${stranded[0]!.title}” is its own ancestor — that file's folder structure loops`);
  }
  if (levels.length > MAX_DEPTH) {
    problems.push(`That file nests more than ${MAX_DEPTH} levels deep — flatten it and try again`);
  }

  return problems;
}

/* ------------------------------------------------------------ the façade -- */

/** `nodes[3].title`, `notes[0].children[2].title` — the address of the field
 *  that was wrong, which is the only part of a zod issue worth showing. */
const addressOf = (path: (string | number)[]) =>
  path.reduce<string>((s, k) => (typeof k === "number" ? `${s}[${k}]` : s ? `${s}.${k}` : String(k)), "");

/**
 * One readable line out of a zod failure.
 *
 * Union errors are the reason this is not `err.issues[0]`. A union reports
 * `invalid_union` at its own path with the real failures buried in
 * `unionErrors`, and both of this file's schemas are unions — so the naive
 * version answers "Invalid input" for every malformed outline. Flattening those
 * out and preferring the deepest path names an actual field instead.
 */
function firstIssue(err: z.ZodError): string {
  const flatten = (issues: z.ZodIssue[]): z.ZodIssue[] =>
    issues.flatMap((i) => (i.code === "invalid_union" ? flatten(i.unionErrors.flatMap((u) => u.issues)) : [i]));

  const all = flatten(err.issues);
  const first = all[0];
  if (!first) return "That file isn't shaped like notes";
  const best = all.reduce((a, b) => (b.path.length > a.path.length ? b : a), first);
  const where = addressOf(best.path);
  return where ? `${where}: ${best.message}` : best.message;
}

/**
 * The one entry point the action and the dialog both call, so a preview and the
 * write it precedes can never disagree about what a payload means.
 */
export function parseImport(
  raw: unknown,
): { ok: true; shape: Shape; nodes: VaultNode[] } | { ok: false; error: string } {
  const shape = detectShape(raw);
  if (!shape) return { ok: false, error: "That isn't a vault export or a nested outline" };

  try {
    if (shape === "vault") {
      const parsed = VaultSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
      const problems = vaultProblems(parsed.data.nodes, parsed.data.count);
      return problems.length ? { ok: false, error: problems[0]! } : { ok: true, shape, nodes: parsed.data.nodes };
    }

    const parsed = NestedSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const nodes = flattenNested(parsed.data);
    const problems = vaultProblems(nodes);
    return problems.length ? { ok: false, error: problems[0]! } : { ok: true, shape, nodes };
  } catch (e) {
    // Never throws: the dialog calls this on every keystroke, and a throw there
    // is a blank screen rather than a message under the textarea.
    if (e instanceof ImportError) return { ok: false, error: e.message };
    return { ok: false, error: "That file couldn't be read as notes" };
  }
}

/** What the dialog previews: the shape of the graft, before any of it exists. */
export function summarise(nodes: VaultNode[]): {
  folders: number;
  questions: number;
  roots: number;
  maxDepth: number;
  tags: string[];
} {
  const { roots, levels } = structure(nodes);
  const tags = new Set<string>();
  let folders = 0;
  for (const n of nodes) {
    if (n.kind === "FOLDER") folders++;
    for (const t of n.tags) tags.add(t);
  }
  return {
    folders,
    questions: nodes.length - folders,
    roots: roots.length,
    maxDepth: levels.length,
    tags: [...tags].sort(),
  };
}
