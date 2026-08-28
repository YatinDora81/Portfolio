import { z } from "zod";
import { VAULT_FORMAT, VAULT_VERSION } from "./export";
import { normaliseTags, slugify, type NoteKind } from "./paths";
import { CONF_NAME } from "./query";

export class ImportError extends Error {}

// one level's insert must stay under 65535 bind params
export const MAX_NODES = 5_000;
export const MAX_BODY = 200_000;
export const MAX_TAG = 64;
// must stay below serverActions.bodySizeLimit in next.config.js
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_DEPTH = 32;

export type ImportMode = "into" | "restore";

export type FolderMode = "merge" | "create";
export type Shape = "vault" | "nested";

export const SHAPE_LABEL: Record<Shape, string> = {
  vault: "vault export",
  nested: "nested outline",
};

const title = z.string().trim().min(1, "Title required").max(300, "Title is too long");

const tags = z
  .union([z.array(z.string()), z.string()])
  .default([])
  .transform((t) => normaliseTags((typeof t === "string" ? t.split(",") : t).map((x) => x.slice(0, MAX_TAG))));

const confidence = z
  .union([z.number(), z.string()])
  .default(0)
  .transform((c) => (typeof c === "number" ? c : (CONF_NAME[c.trim().toLowerCase()] ?? Number(c))))
  .pipe(z.number().int().min(0).max(4).catch(0));

const body = z.string().max(MAX_BODY, "A note body is too large to import");

const ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "That file has an id that is not an id");

export const VaultNodeSchema = z
  .object({
    id: ID,
    parentId: ID.nullable(),
    kind: z.enum(["FOLDER", "QUESTION"]),
    title,
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

export interface NestedNote {
  title: string;
  kind?: NoteKind;
  body?: string;
  tags?: string[];
  confidence?: number;
  children?: NestedNote[];
}

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

export function detectShape(raw: unknown): Shape | null {
  if (Array.isArray(raw)) return "nested";
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.format === VAULT_FORMAT || Array.isArray(o.nodes)) return "vault";
  if (Array.isArray(o.notes)) return "nested";
  return null;
}

export function flattenNested(notes: NestedNote[]): VaultNode[] {
  interface Frame {
    note: NestedNote;
    parentId: string | null;
    depth: number;
    index: number;
  }

  const out: VaultNode[] = [];
  const stack: Frame[] = [];
  // reverse so siblings pop in array order
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

interface Structure {
  roots: VaultNode[];
  childrenOf: Map<string, VaultNode[]>;
  depth: Map<string, number>;
  levels: VaultNode[][];
  stranded: VaultNode[];
}

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

export function fileRoots(nodes: VaultNode[]): VaultNode[] {
  return structure(nodes).roots;
}

export function levelOrder(nodes: VaultNode[]): VaultNode[][] {
  return structure(nodes).levels;
}

export function topoOrder(nodes: VaultNode[]): VaultNode[] {
  const s = structure(nodes);
  return [...s.levels.flat(), ...s.stranded];
}

export interface LiveNode {
  id: string;
  parentId: string | null;
  slug: string;
  kind: NoteKind;
  sortOrder: number;
}

export interface GraftPlan {
  merged: Map<string, string>;
  foldersReused: number;
  foldersCreated: number;
  questionsCreated: number;
}

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

  if (stranded.length) {
    problems.push(`“${stranded[0]!.title}” is its own ancestor — that file's folder structure loops`);
  }
  if (levels.length > MAX_DEPTH) {
    problems.push(`That file nests more than ${MAX_DEPTH} levels deep — flatten it and try again`);
  }

  return problems;
}

const addressOf = (path: (string | number)[]) =>
  path.reduce<string>((s, k) => (typeof k === "number" ? `${s}[${k}]` : s ? `${s}.${k}` : String(k)), "");

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
    if (e instanceof ImportError) return { ok: false, error: e.message };
    return { ok: false, error: "That file couldn't be read as notes" };
  }
}

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
