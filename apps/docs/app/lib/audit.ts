import type { Entity } from "@/lib/actions/staging";

/**
 * The pure half of the audit log: label maps, redaction, and the field diff.
 *
 * Split from `audit-writer.ts` because nothing here imports Prisma and nothing
 * here is a server action, so the history page's client table can import the
 * labels and the badge logic without dragging the Prisma client into a browser
 * bundle. (Types cross the `"use server"` boundary freely — staging.ts already
 * exports `Entity` — but runtime values like these maps cannot, which is the
 * actual reason this module exists.)
 */

export type AuditAction = "SAVE" | "SAVE_AND_PUBLISH" | "PUBLISH";
export type ChangeKind = "CREATE" | "UPDATE" | "DELETE" | "REORDER";
export type AuditActor = { userId: string; name: string; email: string; role: string };

export interface PendingChange {
  seq: number;
  kind: ChangeKind;
  entity: string;
  entityLabel: string;
  rowId: string | null;
  rowLabel: string | null;
  field: string;
  before: string | null;
  after: string | null;
  redacted: boolean;
  truncated: boolean;
}

/**
 * Where each entity is edited. Lives here rather than in save-bar.tsx so the
 * bar and the history name a change identically — one copy means a new entity
 * cannot be labelled in one place and left unlabelled in the other.
 */
export const WHERE: Record<Entity, string> = {
  heroTitle: "Hero · titles",
  heroSkillBadge: "Hero · skill badges",
  heroContent: "Hero · copy and live version",
  aboutParagraph: "About · paragraphs",
  education: "About · education",
  skill: "Skills",
  quote: "Quotes",
  contactPurpose: "Contact purposes",
  socialLink: "Social links",
  adminUser: "Admin users",
};

/**
 * Fields whose VALUES must never reach the log. The change is still recorded —
 * you can see that someone changed a password — but both sides are dropped and
 * the row is flagged `redacted`.
 *
 * `contactMessage` is here because a deleted contact message would otherwise
 * preserve the sender's name, email and body in the history forever, which is
 * the opposite of what deleting it means.
 */
const SECRET: Record<string, Set<string>> = {
  adminUser: new Set(["password", "otp", "otpExpiresAt"]),
};

/** Columns that are never interesting in a diff. */
const IGNORED = new Set(["id", "createdAt", "updatedAt"]);

/** Longest field either side of a diff is stored at. */
export const CAP = 2000;

/** Everything becomes a string, because the log renders text, not JSON. */
function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * A window around the first divergence rather than the head of each side: two
 * 1,800-character blog bodies differing at character 1,500 would otherwise both
 * truncate to identical prefixes and the entry would show no change at all.
 *
 * When one side is null (a create or a delete) there is no divergence point to
 * centre on, so the other side is simply head-truncated.
 */
export function excerpt(
  before: string | null,
  after: string | null
): { before: string | null; after: string | null; truncated: boolean } {
  const head = (v: string | null) =>
    v !== null && v.length > CAP ? { v: v.slice(0, CAP), cut: true } : { v, cut: false };

  if (before === null || after === null) {
    const b = head(before);
    const a = head(after);
    return { before: b.v, after: a.v, truncated: b.cut || a.cut };
  }
  if (before.length <= CAP && after.length <= CAP) return { before, after, truncated: false };

  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  const start = Math.max(0, i - 60);
  const slice = (v: string) => {
    const cut = v.slice(start, start + CAP);
    return (start > 0 ? "…" : "") + cut + (start + CAP < v.length ? "…" : "");
  };
  return { before: slice(before), after: slice(after), truncated: true };
}

/**
 * What a row IS in human terms. Read from the row itself so a deleted row stays
 * legible in the history long after it is gone from the table it lived in.
 */
export function labelOf(entity: string, row: Record<string, unknown> | null): string {
  if (!row) return "";
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  switch (entity) {
    case "heroTitle": return pick("title");
    case "heroContent": return `${pick("version") || "hero"} copy`;
    case "aboutParagraph": return pick("content").slice(0, 60);
    case "education": return pick("institution", "degree");
    case "quote": return pick("quote").slice(0, 60);
    case "contactPurpose": return pick("label");
    case "adminUser": return pick("name", "username", "email");
    case "contactMessage": return "message";
    default: return pick("name", "title", "label");
  }
}

/** How the history table renders an event's action and its publish outcome. */
export function badgeFor(action: string, publishState: string):
  { label: string; tone: "neutral" | "good" | "bad" } {
  if (publishState === "FAILED") return { label: "publish failed", tone: "bad" };
  if (action === "PUBLISH") return { label: "published", tone: "good" };
  if (action === "SAVE_AND_PUBLISH") {
    return publishState === "OK"
      ? { label: "saved & published", tone: "good" }
      : { label: "saved · publish pending", tone: "neutral" };
  }
  return { label: "saved", tone: "neutral" };
}

/**
 * An in-memory draft. Nothing reaches the database until `commitAudit` writes
 * it inside the same transaction as the change it describes.
 */
export class AuditDraft {
  readonly changes: PendingChange[] = [];
  private readonly surfaces = new Set<string>();

  constructor(
    readonly action: AuditAction,
    readonly surface: string,
    readonly actor: AuditActor
  ) {}

  /** One created, updated or deleted row, diffed field by field. */
  row(input: {
    entity: string;
    entityLabel: string;
    rowId: string;
    rowLabel: string;
    kind: "CREATE" | "UPDATE" | "DELETE";
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }): void {
    const { entity, entityLabel, rowId, rowLabel, kind } = input;
    const before = input.before ?? null;
    const after = input.after ?? null;
    const secret = SECRET[entity];

    // An update diffs only what it wrote; a create/delete walks the whole row.
    const keys = kind === "UPDATE"
      ? Object.keys(after ?? {})
      : Object.keys((kind === "CREATE" ? after : before) ?? {});

    for (const key of keys) {
      if (IGNORED.has(key)) continue;
      const b = norm(before?.[key]);
      const a = norm(after?.[key]);
      // Unchanged fields are not changes. This is what keeps a save that
      // touched one column from writing a row per column.
      if (b === a) continue;

      if (secret?.has(key)) {
        this.push({ entity, entityLabel, rowId, rowLabel, kind, field: key,
          before: null, after: null, redacted: true, truncated: false });
        continue;
      }
      const cut = excerpt(b, a);
      this.push({ entity, entityLabel, rowId, rowLabel, kind, field: key,
        before: cut.before, after: cut.after, redacted: false, truncated: cut.truncated });
    }
  }

  /**
   * A drag, collapsed to ONE row holding both orders as names. A reorder on
   * /skills can renumber hundreds of rows; recording each would drown every
   * other change in the event.
   */
  reorder(input: {
    entity: string;
    entityLabel: string;
    before: string[];
    after: string[];
    labels: Map<string, string>;
  }): void {
    const name = (id: string) => input.labels.get(id) || id.slice(0, 8);
    const b = input.before.map(name).join(" → ");
    const a = input.after.map(name).join(" → ");
    if (b === a) return; // a drag that landed where it started is not a change
    const cut = excerpt(b, a);
    this.push({
      entity: input.entity, entityLabel: input.entityLabel, rowId: null, rowLabel: null,
      kind: "REORDER", field: "order", before: cut.before, after: cut.after,
      redacted: false, truncated: cut.truncated,
    });
  }

  private push(c: Omit<PendingChange, "seq">): void {
    this.changes.push({ ...c, seq: this.changes.length });
    this.surfaces.add(c.entityLabel);
  }

  get isEmpty(): boolean {
    return this.changes.length === 0;
  }

  /** Precomputed so the list page never loads an event's children to render it. */
  get summary(): string {
    const n = this.changes.length;
    const where = [...this.surfaces].join(", ");
    if (n === 0) return this.action === "PUBLISH" ? "Published the site" : "No changes";
    return `${n} change${n === 1 ? "" : "s"} · ${where}`;
  }
}

export function draft(action: AuditAction, surface: string, actor: AuditActor): AuditDraft {
  return new AuditDraft(action, surface, actor);
}
