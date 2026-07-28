"use server";

import bcrypt from "bcryptjs";
import { prisma, type ScoreType } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

/**
 * The commit endpoint behind the admin's Cancel / Save / Save & Publish bar.
 *
 * Every table stages its edits in the browser and hands the whole batch here, so
 * this is the single door a staged change walks through. Three facts shape the
 * code below:
 *
 * 1. **The payload is untrusted.** `"use server"` exports compile to public POST
 *    endpoints addressable by action id, so any signed-in browser can call this
 *    with whatever JSON it likes — the staging UI is not a gate. Nothing is ever
 *    spread into a Prisma `data` object: every column is read out by name and
 *    coerced, per entity, and `entity` is matched against a closed union rather
 *    than used to index a model accessor. Without that,
 *    `{ entity: "adminUser", fields: { role: "OWNER", password: "…" } }` would be
 *    a one-request privilege escalation.
 * 2. **The batch is all-or-nothing.** One `$transaction` wraps the lot, so a
 *    half-applied batch — the deletes but not the reorder — can never exist.
 *    Order inside it is creates → updates → deletes → reorders, because later
 *    ops may name a row the creates only just brought into existence.
 * 3. **Nothing expensive happens before the caller is refused.** The batch is
 *    capped and `preflight` runs the free half of authorization *before*
 *    `hashPasswords`, so hostile input can't make the server spend minutes on
 *    bcrypt for a request it was always going to reject.
 *
 * Saving is not publishing. `revalidatePath` refreshes the admin's own render
 * cache; the public site only moves when someone calls `publishSite()`.
 */

/** The entities that support staging. Anything else is rejected outright. */
export type Entity =
  | "heroTitle"
  | "heroSkillBadge"
  | "aboutParagraph"
  | "education"
  | "skill"
  | "quote"
  | "contactPurpose"
  | "socialLink"
  | "adminUser";

/** Client-supplied column bag. Every read out of it is checked and coerced. */
export type StagedFields = Record<string, unknown>;

export type StagedOp =
  | { kind: "create"; entity: Entity; tempId: string; fields: StagedFields }
  | { kind: "update"; entity: Entity; id: string; fields: StagedFields }
  /**
   * `restore` is the browser's undo buffer for an edit this delete folded away.
   * It rides along on the op so the store can hand it back, and `normalizeOps`
   * drops it — the server never reads it.
   */
  | { kind: "delete"; entity: Entity; id: string; restore?: StagedFields }
  /**
   * `version` scopes the drag to one tab so two versions of the same entity can
   * each hold a pending reorder. `normalizeOps` drops it — the server doesn't
   * need it, because `reorderRows` renumbers only the ids it is handed and every
   * op's ids come from a single tab.
   */
  | { kind: "reorder"; entity: Entity; ids: string[]; version?: string | null };

export type ApplyStagedResult =
  | { ok: true; idMap: Record<string, string> }
  | { ok: false; error: string };

/**
 * Applies a whole batch of staged changes in one transaction.
 *
 * Returns `idMap`, the client's `tempId` → real database id, so the store can
 * reconcile the rows it optimistically rendered.
 */
export async function applyStagedChanges(ops: StagedOp[]): Promise<ApplyStagedResult> {
  // Middleware only proves the session cookie is a valid JWT and never runs for
  // a direct action POST at all, so the check has to happen here.
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  const actor = { userId: session.userId, role: session.role };

  try {
    const plan = normalizeOps(ops);
    if (plan.length === 0) return { ok: true, idMap: {} };

    // Everything that can reject the batch for free happens before anything
    // expensive does. See `preflight`: hashing is the one unbounded cost in
    // this request and a caller must not be able to buy it on credit.
    preflight(plan, actor);

    // bcrypt is deliberately slow. Hash before opening the transaction so a
    // batch containing an admin user doesn't hold a connection open for it.
    const hashes = await hashPasswords(plan);

    const idMap: Record<string, string> = {};
    /** Real ids this batch removes — reorders must not try to renumber them. */
    const deleted = new Set<string>();

    await prisma.$transaction(
      async (tx) => {
        // A new row's sortOrder is max+1, per entity. The cursor keeps several
        // creates in one batch from all landing on the same slot.
        const cursors = new Map<Entity, number>();

        for (const [i, op] of plan.entries()) {
          if (op.kind !== "create") continue;
          idMap[op.tempId] = await createRow(tx, op.entity, op.fields, actor, hashes.get(i), cursors);
        }

        for (const [i, op] of plan.entries()) {
          if (op.kind !== "update") continue;
          await updateRow(tx, op.entity, resolve(idMap, op.id), op.fields, actor, hashes.get(i));
        }

        for (const op of plan) {
          if (op.kind !== "delete") continue;
          const id = resolve(idMap, op.id);
          await deleteRow(tx, op.entity, id, actor);
          deleted.add(id);
        }

        for (const op of plan) {
          if (op.kind !== "reorder") continue;
          const entity = op.entity;
          if (!isSortable(entity)) fail(`${LABEL[entity]}s can't be reordered.`);
          // Strip rows this same batch deleted (and any duplicate), then write
          // sortOrder densely from 0 so the list has no gaps.
          const seen = new Set<string>();
          const ids: string[] = [];
          for (const raw of op.ids) {
            const id = resolve(idMap, raw);
            if (deleted.has(id) || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
          }
          await reorderRows(tx, entity, ids);
        }
      },
      // Generous next to the 5s default: a batch can be dozens of round trips
      // and the database is remote.
      { maxWait: 5_000, timeout: 20_000 }
    );

    for (const path of affectedPaths(plan)) revalidatePath(path);
    return { ok: true, idMap };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

/* ------------------------------------------------------------------ wiring */

/**
 * The client handed to an interactive `$transaction` callback: the full client
 * minus the methods Prisma denies inside a transaction, minus `$transaction`
 * itself since nothing here may open a nested one.
 */
type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends" | "$transaction"
>;

/** Entities whose rows carry a `sortOrder`, i.e. the reorderable ones. */
type SortableEntity = Exclude<Entity, "quote" | "adminUser">;

/** Admin routes to re-render after a write. Doubles as the entity allow-list. */
const ENTITY_PATHS: Record<Entity, readonly string[]> = {
  heroTitle: ["/hero/titles"],
  heroSkillBadge: ["/hero/skill-badges"],
  aboutParagraph: ["/about/paragraphs"],
  education: ["/about/education"],
  skill: ["/skills"],
  quote: ["/quotes"],
  contactPurpose: ["/contact-purposes"],
  socialLink: ["/social-links", "/links"],
  adminUser: ["/admin-users"],
};

const SORTABLE: Record<SortableEntity, true> = {
  heroTitle: true,
  heroSkillBadge: true,
  aboutParagraph: true,
  education: true,
  skill: true,
  contactPurpose: true,
  socialLink: true,
};

/** Human names, so a rejected field reads sanely in a toast. */
const LABEL: Record<Entity, string> = {
  heroTitle: "hero title",
  heroSkillBadge: "hero skill badge",
  aboutParagraph: "about paragraph",
  education: "education entry",
  skill: "skill",
  quote: "quote",
  contactPurpose: "contact purpose",
  socialLink: "social link",
  adminUser: "admin user",
};

function isEntity(v: unknown): v is Entity {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ENTITY_PATHS, v);
}

function isSortable(e: Entity): e is SortableEntity {
  return Object.prototype.hasOwnProperty.call(SORTABLE, e);
}

function affectedPaths(plan: StagedOp[]): Set<string> {
  const paths = new Set<string>();
  for (const op of plan) for (const p of ENTITY_PATHS[op.entity]) paths.add(p);
  return paths;
}

/* ------------------------------------------------------------------ errors */

/** Messages raised here are written for a toast; Prisma's are not. */
class StagingError extends Error {}

function fail(message: string): never {
  throw new StagingError(message);
}

function toMessage(e: unknown): string {
  if (e instanceof StagingError) return e.message;
  const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : null;
  if (code === "P2002") return "That email or username is already taken.";
  if (code === "P2025") return "One of the rows you changed no longer exists. Refresh and try again.";
  return "Couldn't save your changes. Nothing was applied.";
}

/* -------------------------------------------------------------- the payload */

/**
 * Ceilings on one batch. The admin never comes close — the largest surface is a
 * few dozen rows — but the caller is a public POST, and every op below is at
 * least one round trip inside a 20s transaction. Unbounded input is the whole
 * attack: it turns "reject this request" into minutes of work first.
 */
const MAX_OPS = 500;
const MAX_REORDER_IDS = 500;
/** Each of these is a ~50ms bcrypt hash, so this cap is the one that matters. */
const MAX_ACCOUNT_OPS = 25;

/**
 * Shape-checks the batch before anything touches the database. `ops` is typed
 * for the client's benefit; over the wire it is whatever the caller sent.
 */
function normalizeOps(ops: unknown): StagedOp[] {
  if (!Array.isArray(ops)) fail("Nothing to save.");
  if (ops.length > MAX_OPS) {
    fail(`That's too many changes to save at once — ${MAX_OPS} is the limit. Save in smaller batches.`);
  }
  return ops.map((raw): StagedOp => {
    if (typeof raw !== "object" || raw === null) fail("Malformed change.");
    const op = raw as Record<string, unknown>;
    const entity = op.entity;
    if (!isEntity(entity)) fail(`"${String(entity)}" isn't something this page can save.`);

    const kind = op.kind;
    switch (kind) {
      case "create": {
        const tempId = op.tempId;
        if (typeof tempId !== "string" || tempId === "") fail("A new row arrived without a temporary id.");
        return { kind: "create", entity, tempId, fields: asFields(op.fields) };
      }
      case "update": {
        return { kind: "update", entity, id: asId(op.id), fields: asFields(op.fields) };
      }
      case "delete": {
        return { kind: "delete", entity, id: asId(op.id) };
      }
      case "reorder": {
        const ids = op.ids;
        if (!Array.isArray(ids)) fail("A reorder arrived without its row ids.");
        // Every id here is its own `updateMany` inside the transaction.
        if (ids.length > MAX_REORDER_IDS) fail("That reorder covers too many rows.");
        const clean = ids.filter((v): v is string => typeof v === "string" && v !== "");
        if (clean.length !== ids.length) fail("A reorder carried an invalid row id.");
        return { kind: "reorder", entity, ids: clean };
      }
      default:
        fail(`"${String(kind)}" isn't a kind of change this endpoint applies.`);
    }
  });
}

function asId(v: unknown): string {
  if (typeof v !== "string" || v === "") fail("A change arrived without a row id.");
  return v;
}

function asFields(v: unknown): StagedFields {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail("A change arrived without any fields.");
  return v as StagedFields;
}

/** tempId → real id, falling through untouched for rows that already existed. */
function resolve(idMap: Record<string, string>, id: string): string {
  return idMap[id] ?? id;
}

/* ----------------------------------------------------------- field coercion */

function present(f: StagedFields, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(f, key) && f[key] !== undefined;
}

/** A required string: must be there, must be a string, must not be blank. */
function req(f: StagedFields, key: string, entity: Entity): string {
  const v = f[key];
  if (typeof v !== "string" || v.trim() === "") fail(`${LABEL[entity]}: "${key}" is required.`);
  return v.trim();
}

/**
 * A NOT NULL string column the UI genuinely allows to be blank — an icon key
 * with no match already renders as "no icon", so absent and blank both mean "".
 */
function text(f: StagedFields, key: string, entity: Entity): string {
  const v = f[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") fail(`${LABEL[entity]}: "${key}" must be text.`);
  return v.trim();
}

/** A nullable string column — blank collapses to NULL, as the actions do today. */
function nullable(f: StagedFields, key: string, entity: Entity): string | null {
  const v = f[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${LABEL[entity]}: "${key}" must be text.`);
  return v.trim() === "" ? null : v.trim();
}

function bool(f: StagedFields, key: string, entity: Entity): boolean {
  const v = f[key];
  if (typeof v === "boolean") return v;
  // The existing form posts these as the strings "true"/"false".
  if (v === "true") return true;
  if (v === "false") return false;
  fail(`${LABEL[entity]}: "${key}" must be true or false.`);
}

function scoreType(f: StagedFields): ScoreType | null {
  const v = f.scoreType;
  return v === "CGPA" || v === "PERCENTAGE" ? v : null;
}

/** Never reuse `nullable()` for this — it would let any string into the column. */
function versionReq(f: StagedFields, entity: Entity): "v1" | "v2" {
  const v = f.version;
  if (v !== "v1" && v !== "v2") fail(`${LABEL[entity]}: "version" must be v1 or v2.`);
  return v;
}

/** Blank means null: shown in every version. */
function versionOpt(f: StagedFields, entity: Entity): "v1" | "v2" | null {
  const v = f.version;
  if (v === undefined || v === null || v === "") return null;
  if (v !== "v1" && v !== "v2") fail(`${LABEL[entity]}: "version" must be v1, v2 or blank.`);
  return v;
}

/** An update that recognised none of its fields is a bug worth surfacing. */
function nonEmpty(data: object, entity: Entity): void {
  if (Object.keys(data).length === 0) fail(`${LABEL[entity]}: nothing recognisable to update.`);
}

/* --------------------------------------------------------------- the roles */

/**
 * Mirrors `lib/actions/admin-users.ts`. Duplicated rather than imported because
 * a `"use server"` module may only export async functions.
 */
type Role = "OWNER" | "ADMIN" | "SUB_ADMIN";

const ROLE_LEVEL: Record<Role, number> = { OWNER: 3, ADMIN: 2, SUB_ADMIN: 1 };

function isRole(v: unknown): v is Role {
  return v === "OWNER" || v === "ADMIN" || v === "SUB_ADMIN";
}

function level(role: string): number {
  return isRole(role) ? ROLE_LEVEL[role] : 0;
}

/** You may only act on, or hand out, a role strictly below your own. */
function assertOutranks(actorRole: string, targetRole: string, what: string): void {
  if (level(actorRole) <= level(targetRole)) fail(`You don't have permission to ${what}.`);
}

type Actor = { userId: string; role: string };

/**
 * The pre-transaction gate: everything a batch can be rejected for without
 * touching the database, run before the batch costs anything.
 *
 * It exists because of one ordering hazard. `hashPasswords` runs a ~50ms bcrypt
 * per admin-user op, while the role checks that decide whether the actor may
 * touch an admin user at all live inside the transaction, *after* it. A
 * SUB_ADMIN — who can never pass those checks — could therefore post a few
 * hundred admin-user ops and buy minutes of pegged main-thread CPU on work the
 * server was always going to refuse. bcryptjs is pure JS on the Node thread, so
 * that stalls every other request in the admin.
 *
 * The gate is exact, not a heuristic: every admin-user write ends in
 * `assertOutranks(actor, target)`, and the lowest role anyone can hold is
 * SUB_ADMIN — so an actor who cannot outrank SUB_ADMIN cannot pass a single one
 * of them, whatever the target turns out to be. That verdict needs no query.
 * Creates go further, since their assigned role is right there in the payload.
 *
 * The in-transaction checks stay authoritative — this only refuses early.
 */
function preflight(plan: StagedOp[], actor: Actor): void {
  let accounts = 0;
  for (const op of plan) {
    if (op.entity !== "adminUser") continue;
    // Deletes hash nothing, and `deleteRow` has its own (better-worded) guards.
    if (op.kind !== "create" && op.kind !== "update") continue;

    assertOutranks(actor.role, "SUB_ADMIN", "manage admin accounts");

    if (op.kind === "create") {
      const role = op.fields.role;
      const assigned: Role = isRole(role) ? role : "SUB_ADMIN";
      assertOutranks(actor.role, assigned, `create a ${assigned} account`);
    }

    // Even an OWNER doesn't legitimately rewrite two dozen accounts in one
    // save, and the hashes are sequential.
    if (++accounts > MAX_ACCOUNT_OPS) {
      fail(`One save can only add or change ${MAX_ACCOUNT_OPS} accounts at a time.`);
    }
  }
}

/**
 * Hashes every admin-user password in the batch up front, keyed by op index.
 * Creates must carry one; updates only change it when one is supplied — the
 * same rule `createAdminUser` / `updateAdminUser` enforce today.
 */
async function hashPasswords(plan: StagedOp[]): Promise<Map<number, string>> {
  const hashes = new Map<number, string>();
  for (const [i, op] of plan.entries()) {
    if (op.entity !== "adminUser") continue;
    if (op.kind !== "create" && op.kind !== "update") continue;
    const password = op.fields.password;
    if (op.kind === "update" && (password === undefined || password === null || password === "")) continue;
    if (typeof password !== "string" || password.length < 6) {
      fail("Password must be at least 6 characters.");
    }
    hashes.set(i, await bcrypt.hash(password, 10));
  }
  return hashes;
}

/* -------------------------------------------------------------- the writes */

/**
 * The `sortOrder` of the next new row of this entity. Seeded from max+1 (never
 * count+1 — that reuses an occupied slot after a delete) and then advanced in
 * memory so N creates in one batch get N consecutive slots.
 */
async function nextSortOrder(tx: TxClient, entity: SortableEntity, cursors: Map<Entity, number>): Promise<number> {
  const cursor = cursors.get(entity);
  const next = cursor ?? (await maxSortOrder(tx, entity)) + 1;
  cursors.set(entity, next + 1);
  return next;
}

async function maxSortOrder(tx: TxClient, entity: SortableEntity): Promise<number> {
  switch (entity) {
    case "heroTitle": {
      const { _max } = await tx.heroTitle.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
    case "heroSkillBadge": {
      const { _max } = await tx.heroSkillBadge.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
    case "aboutParagraph": {
      const { _max } = await tx.aboutParagraph.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
    case "education": {
      const { _max } = await tx.education.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
    case "skill": {
      const { _max } = await tx.skill.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
    case "contactPurpose": {
      const { _max } = await tx.contactPurpose.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
    case "socialLink": {
      const { _max } = await tx.socialLink.aggregate({ _max: { sortOrder: true } });
      return _max.sortOrder ?? -1;
    }
  }
}

async function createRow(
  tx: TxClient,
  entity: Entity,
  f: StagedFields,
  actor: Actor,
  passwordHash: string | undefined,
  cursors: Map<Entity, number>
): Promise<string> {
  switch (entity) {
    case "heroTitle": {
      const row = await tx.heroTitle.create({
        data: {
          title: req(f, "title", entity),
          sortOrder: await nextSortOrder(tx, entity, cursors),
          version: versionReq(f, entity),
        },
        select: { id: true },
      });
      return row.id;
    }
    case "heroSkillBadge": {
      const row = await tx.heroSkillBadge.create({
        data: {
          name: req(f, "name", entity),
          iconKey: text(f, "iconKey", entity),
          sortOrder: await nextSortOrder(tx, entity, cursors),
          version: versionReq(f, entity),
        },
        select: { id: true },
      });
      return row.id;
    }
    case "aboutParagraph": {
      const row = await tx.aboutParagraph.create({
        data: { content: req(f, "content", entity), sortOrder: await nextSortOrder(tx, entity, cursors) },
        select: { id: true },
      });
      return row.id;
    }
    case "education": {
      const row = await tx.education.create({
        data: {
          institution: req(f, "institution", entity),
          location: req(f, "location", entity),
          degree: req(f, "degree", entity),
          scoreType: scoreType(f),
          score: nullable(f, "score", entity),
          scoreTotal: nullable(f, "scoreTotal", entity),
          startYear: req(f, "startYear", entity),
          endYear: req(f, "endYear", entity),
          sortOrder: await nextSortOrder(tx, entity, cursors),
        },
        select: { id: true },
      });
      return row.id;
    }
    case "skill": {
      const row = await tx.skill.create({
        data: {
          name: req(f, "name", entity),
          iconKey: text(f, "iconKey", entity),
          show: present(f, "show") ? bool(f, "show", entity) : true,
          sortOrder: await nextSortOrder(tx, entity, cursors),
        },
        select: { id: true },
      });
      return row.id;
    }
    case "quote": {
      const row = await tx.quote.create({
        data: { quote: req(f, "quote", entity), author: req(f, "author", entity) },
        select: { id: true },
      });
      return row.id;
    }
    case "contactPurpose": {
      const row = await tx.contactPurpose.create({
        data: {
          label: req(f, "label", entity),
          emoji: req(f, "emoji", entity),
          sortOrder: await nextSortOrder(tx, entity, cursors),
        },
        select: { id: true },
      });
      return row.id;
    }
    case "socialLink": {
      const row = await tx.socialLink.create({
        data: {
          name: req(f, "name", entity),
          href: req(f, "href", entity),
          iconKey: text(f, "iconKey", entity),
          detail: nullable(f, "detail", entity),
          sortOrder: await nextSortOrder(tx, entity, cursors),
          version: versionOpt(f, entity),
        },
        select: { id: true },
      });
      return row.id;
    }
    case "adminUser": {
      // `role` is never taken as given: it must be a known role AND sit strictly
      // below the caller's, or the lowest role could mint an OWNER.
      const role = f.role;
      const assigned: Role = isRole(role) ? role : "SUB_ADMIN";
      assertOutranks(actor.role, assigned, `create a ${assigned} account`);
      if (!passwordHash) fail("Password must be at least 6 characters.");
      const row = await tx.adminUser.create({
        data: {
          email: req(f, "email", entity),
          username: req(f, "username", entity),
          password: passwordHash,
          name: req(f, "name", entity),
          role: assigned,
        },
        select: { id: true },
      });
      return row.id;
    }
  }
}

/**
 * Updates are partial by design — a visibility toggle stages `{ show }` alone —
 * so only the keys actually present are written. Keys outside the entity's list
 * are ignored rather than forwarded.
 */
async function updateRow(
  tx: TxClient,
  entity: Entity,
  id: string,
  f: StagedFields,
  actor: Actor,
  passwordHash: string | undefined
): Promise<void> {
  switch (entity) {
    case "heroTitle": {
      const data: { title?: string } = {};
      if (present(f, "title")) data.title = req(f, "title", entity);
      nonEmpty(data, entity);
      await tx.heroTitle.update({ where: { id }, data });
      return;
    }
    case "heroSkillBadge": {
      const data: { name?: string; iconKey?: string } = {};
      if (present(f, "name")) data.name = req(f, "name", entity);
      if (present(f, "iconKey")) data.iconKey = text(f, "iconKey", entity);
      nonEmpty(data, entity);
      await tx.heroSkillBadge.update({ where: { id }, data });
      return;
    }
    case "aboutParagraph": {
      const data: { content?: string } = {};
      if (present(f, "content")) data.content = req(f, "content", entity);
      nonEmpty(data, entity);
      await tx.aboutParagraph.update({ where: { id }, data });
      return;
    }
    case "education": {
      const data: {
        institution?: string;
        location?: string;
        degree?: string;
        scoreType?: ScoreType | null;
        score?: string | null;
        scoreTotal?: string | null;
        startYear?: string;
        endYear?: string;
      } = {};
      if (present(f, "institution")) data.institution = req(f, "institution", entity);
      if (present(f, "location")) data.location = req(f, "location", entity);
      if (present(f, "degree")) data.degree = req(f, "degree", entity);
      if (present(f, "scoreType")) data.scoreType = scoreType(f);
      if (present(f, "score")) data.score = nullable(f, "score", entity);
      if (present(f, "scoreTotal")) data.scoreTotal = nullable(f, "scoreTotal", entity);
      if (present(f, "startYear")) data.startYear = req(f, "startYear", entity);
      if (present(f, "endYear")) data.endYear = req(f, "endYear", entity);
      nonEmpty(data, entity);
      await tx.education.update({ where: { id }, data });
      return;
    }
    case "skill": {
      const data: { name?: string; iconKey?: string; show?: boolean } = {};
      if (present(f, "name")) data.name = req(f, "name", entity);
      if (present(f, "iconKey")) data.iconKey = text(f, "iconKey", entity);
      if (present(f, "show")) data.show = bool(f, "show", entity);
      nonEmpty(data, entity);
      await tx.skill.update({ where: { id }, data });
      return;
    }
    case "quote": {
      const data: { quote?: string; author?: string } = {};
      if (present(f, "quote")) data.quote = req(f, "quote", entity);
      if (present(f, "author")) data.author = req(f, "author", entity);
      nonEmpty(data, entity);
      await tx.quote.update({ where: { id }, data });
      return;
    }
    case "contactPurpose": {
      const data: { label?: string; emoji?: string } = {};
      if (present(f, "label")) data.label = req(f, "label", entity);
      if (present(f, "emoji")) data.emoji = req(f, "emoji", entity);
      nonEmpty(data, entity);
      await tx.contactPurpose.update({ where: { id }, data });
      return;
    }
    case "socialLink": {
      const data: {
        name?: string; href?: string; iconKey?: string; detail?: string | null;
        version?: "v1" | "v2" | null;
      } = {};
      if (present(f, "name")) data.name = req(f, "name", entity);
      if (present(f, "href")) data.href = req(f, "href", entity);
      if (present(f, "iconKey")) data.iconKey = text(f, "iconKey", entity);
      if (present(f, "detail")) data.detail = nullable(f, "detail", entity);
      if (present(f, "version")) data.version = versionOpt(f, entity);
      nonEmpty(data, entity);
      await tx.socialLink.update({ where: { id }, data });
      return;
    }
    case "adminUser": {
      // Both ends are checked: you must outrank who they are today, and the role
      // you assign must sit below your own. The second is what stops an actor
      // editing itself upward.
      const target = await tx.adminUser.findUnique({ where: { id }, select: { role: true } });
      if (!target) fail("That account no longer exists.");
      assertOutranks(actor.role, target.role, "edit this account");

      const data: { email?: string; username?: string; name?: string; role?: Role; password?: string } = {};
      if (present(f, "email")) data.email = req(f, "email", entity);
      if (present(f, "username")) data.username = req(f, "username", entity);
      if (present(f, "name")) data.name = req(f, "name", entity);
      if (present(f, "role")) {
        const nextRole = f.role;
        if (!isRole(nextRole)) fail("Unknown role.");
        assertOutranks(actor.role, nextRole, `assign the ${nextRole} role`);
        data.role = nextRole;
      }
      if (passwordHash) data.password = passwordHash;
      nonEmpty(data, entity);
      await tx.adminUser.update({ where: { id }, data });
      return;
    }
  }
}

/**
 * `deleteMany` rather than `delete` so a row someone else already removed is a
 * no-op instead of a rollback of the entire batch. Admin users keep the strict
 * path — the guards there matter more than the convenience.
 */
async function deleteRow(tx: TxClient, entity: Entity, id: string, actor: Actor): Promise<void> {
  switch (entity) {
    case "heroTitle":
      await tx.heroTitle.deleteMany({ where: { id } });
      return;
    case "heroSkillBadge":
      await tx.heroSkillBadge.deleteMany({ where: { id } });
      return;
    case "aboutParagraph":
      await tx.aboutParagraph.deleteMany({ where: { id } });
      return;
    case "education":
      await tx.education.deleteMany({ where: { id } });
      return;
    case "skill":
      await tx.skill.deleteMany({ where: { id } });
      return;
    case "quote":
      await tx.quote.deleteMany({ where: { id } });
      return;
    case "contactPurpose":
      await tx.contactPurpose.deleteMany({ where: { id } });
      return;
    case "socialLink":
      await tx.socialLink.deleteMany({ where: { id } });
      return;
    case "adminUser": {
      // Identity comes from the cookie, never from an argument.
      if (id === actor.userId) fail("You cannot delete your own account.");
      const target = await tx.adminUser.findUnique({ where: { id }, select: { role: true } });
      if (!target) fail("That account no longer exists.");
      assertOutranks(actor.role, target.role, "delete this account");
      await tx.adminUser.delete({ where: { id } });
      return;
    }
  }
}

/**
 * Writes `sortOrder` densely from 0 over `ids`. `updateMany` again, so an id the
 * client is a beat behind on renumbers nothing instead of throwing.
 */
async function reorderRows(tx: TxClient, entity: SortableEntity, ids: string[]): Promise<void> {
  switch (entity) {
    case "heroTitle":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.heroTitle.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
    case "heroSkillBadge":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.heroSkillBadge.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
    case "aboutParagraph":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.aboutParagraph.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
    case "education":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.education.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
    case "skill":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.skill.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
    case "contactPurpose":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.contactPurpose.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
    case "socialLink":
      for (const [sortOrder, id] of ids.entries()) {
        await tx.socialLink.updateMany({ where: { id }, data: { sortOrder } });
      }
      return;
  }
}
