"use server";

import bcrypt from "bcryptjs";
import { prisma, type ScoreType } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { draft, labelOf, WHERE } from "@/lib/audit";
import { commitAudit, resolveActor } from "@/lib/audit-writer";

export type Entity =
  | "heroTitle"
  | "heroSkillBadge"
  | "heroContent"
  | "aboutParagraph"
  | "education"
  | "skill"
  | "quote"
  | "contactPurpose"
  | "socialLink"
  | "adminUser";

export type StagedFields = Record<string, unknown>;

export type StagedOp =
  | { kind: "create"; entity: Entity; tempId: string; fields: StagedFields }
  | { kind: "update"; entity: Entity; id: string; fields: StagedFields }
  | { kind: "delete"; entity: Entity; id: string; restore?: StagedFields }
  | { kind: "reorder"; entity: Entity; ids: string[]; version?: string | null };

export type ApplyStagedResult =
  | { ok: true; idMap: Record<string, string>; eventId?: string }
  | { ok: false; error: string };

export async function applyStagedChanges(ops: StagedOp[], intent?: unknown): Promise<ApplyStagedResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  const actor = { userId: session.userId, role: session.role };
  const action = intent === "SAVE_AND_PUBLISH" ? "SAVE_AND_PUBLISH" : "SAVE";

  try {
    const plan = normalizeOps(ops);
    if (plan.length === 0) return { ok: true, idMap: {} };

    preflight(plan, actor);

    const hashes = await hashPasswords(plan);

    const idMap: Record<string, string> = {};
    const deleted = new Set<string>();
    let eventId: string | null = null;

    await prisma.$transaction(
      async (tx) => {
        const cursors = new Map<Entity, number>();
        const d = draft(action, "staging", await resolveActor(tx, session));

        for (const [i, op] of plan.entries()) {
          if (op.kind !== "create") continue;
          idMap[op.tempId] = await createRow(tx, op.entity, op.fields, actor, hashes.get(i), cursors);
        }

        const before = await snapshotPlan(tx, plan, idMap, ["update", "delete", "reorder"]);

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

        const after = await snapshotPlan(tx, plan, idMap, ["create", "update"]);
        recordBatch(d, plan, idMap, before, after, deleted);
        eventId = await commitAudit(tx, d);
      },
      { maxWait: 5_000, timeout: 20_000 }
    );

    for (const path of affectedPaths(plan)) revalidatePath(path);
    return { ok: true, idMap, eventId: eventId ?? undefined };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

type Row = Record<string, unknown>;
type Shadow = Map<Entity, Map<string, Row>>;

async function snapshotPlan(
  tx: TxClient,
  plan: StagedOp[],
  idMap: Record<string, string>,
  kinds: StagedOp["kind"][]
): Promise<Shadow> {
  const wanted = new Map<Entity, Set<string>>();
  for (const op of plan) {
    if (!kinds.includes(op.kind)) continue;
    const set = wanted.get(op.entity) ?? new Set<string>();
    if (op.kind === "create") set.add(resolve(idMap, op.tempId));
    else if (op.kind === "reorder") for (const raw of op.ids) set.add(resolve(idMap, raw));
    else set.add(resolve(idMap, op.id));
    wanted.set(op.entity, set);
  }

  const shadow: Shadow = new Map();
  for (const [entity, set] of wanted) {
    const ids = [...set];
    const rows = await readRows(tx, entity, ids);
    shadow.set(entity, new Map(rows.map((r) => [String(r.id), r])));
  }
  return shadow;
}

async function readRows(tx: TxClient, entity: Entity, ids: string[]): Promise<Row[]> {
  const where = { id: { in: ids } };
  switch (entity) {
    case "heroTitle": return tx.heroTitle.findMany({ where });
    case "heroSkillBadge": return tx.heroSkillBadge.findMany({ where });
    case "heroContent": return tx.heroContent.findMany();
    case "aboutParagraph": return tx.aboutParagraph.findMany({ where });
    case "education": return tx.education.findMany({ where });
    case "skill": return tx.skill.findMany({ where });
    case "quote": return tx.quote.findMany({ where });
    case "contactPurpose": return tx.contactPurpose.findMany({ where });
    case "socialLink": return tx.socialLink.findMany({ where });
    case "adminUser":
      return tx.adminUser.findMany({
        where,
        select: { id: true, email: true, username: true, name: true, role: true },
      });
  }
}

function recordBatch(
  d: ReturnType<typeof draft>,
  plan: StagedOp[],
  idMap: Record<string, string>,
  before: Shadow,
  after: Shadow,
  deleted: Set<string>
): void {
  const row = (s: Shadow, e: Entity, id: string) => s.get(e)?.get(id) ?? null;

  for (const op of plan) {
    const entity = op.entity;
    const entityLabel = WHERE[entity];

    if (op.kind === "create") {
      const id = resolve(idMap, op.tempId);
      const now = row(after, entity, id);
      d.row({ entity, entityLabel, rowId: id, rowLabel: labelOf(entity, now),
        kind: "CREATE", before: null, after: now });
    } else if (op.kind === "update") {
      const id = resolve(idMap, op.id);
      const was = row(before, entity, id);
      const now = row(after, entity, id);
      d.row({ entity, entityLabel, rowId: id, rowLabel: labelOf(entity, now ?? was),
        kind: "UPDATE", before: was, after: now });
    } else if (op.kind === "delete") {
      const id = resolve(idMap, op.id);
      const was = row(before, entity, id);
      d.row({ entity, entityLabel, rowId: id, rowLabel: labelOf(entity, was),
        kind: "DELETE", before: was, after: null });
    } else {
      const mine = before.get(entity);
      if (!mine) continue;
      const live = [...mine.values()].filter((r) => !deleted.has(String(r.id)));
      const wasOrder = live
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((r) => String(r.id));
      const nowOrder = op.ids.map((raw) => resolve(idMap, raw)).filter((id) => !deleted.has(id));
      const labels = new Map(live.map((r) => [String(r.id), labelOf(entity, r)] as const));
      d.reorder({ entity, entityLabel, before: wasOrder, after: nowOrder, labels });
    }
  }
}

type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends" | "$transaction"
>;

type SortableEntity = Exclude<Entity, "quote" | "adminUser" | "heroContent">;

const ENTITY_PATHS: Record<Entity, readonly string[]> = {
  heroTitle: ["/hero"],
  heroSkillBadge: ["/hero"],
  heroContent: ["/hero", "/site-config", "/dashboard"],
  aboutParagraph: ["/about"],
  education: ["/about"],
  skill: ["/skills"],
  quote: ["/quotes"],
  contactPurpose: ["/contact-purposes"],
  socialLink: ["/hero"],
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

const LABEL: Record<Entity, string> = {
  heroTitle: "hero title",
  heroSkillBadge: "hero skill badge",
  heroContent: "hero copy",
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

const MAX_OPS = 500;
const MAX_REORDER_IDS = 500;
const MAX_ACCOUNT_OPS = 25;

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

function resolve(idMap: Record<string, string>, id: string): string {
  return idMap[id] ?? id;
}

function present(f: StagedFields, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(f, key) && f[key] !== undefined;
}

function req(f: StagedFields, key: string, entity: Entity): string {
  const v = f[key];
  if (typeof v !== "string" || v.trim() === "") fail(`${LABEL[entity]}: "${key}" is required.`);
  return v.trim();
}

function text(f: StagedFields, key: string, entity: Entity): string {
  const v = f[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") fail(`${LABEL[entity]}: "${key}" must be text.`);
  return v.trim();
}

function nullable(f: StagedFields, key: string, entity: Entity): string | null {
  const v = f[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${LABEL[entity]}: "${key}" must be text.`);
  return v.trim() === "" ? null : v.trim();
}

function bool(f: StagedFields, key: string, entity: Entity): boolean {
  const v = f[key];
  if (typeof v === "boolean") return v;
  // the form posts these as the strings "true"/"false"
  if (v === "true") return true;
  if (v === "false") return false;
  fail(`${LABEL[entity]}: "${key}" must be true or false.`);
}

function scoreType(f: StagedFields): ScoreType | null {
  const v = f.scoreType;
  return v === "CGPA" || v === "PERCENTAGE" ? v : null;
}

function versionReq(f: StagedFields, entity: Entity): "v1" | "v2" {
  const v = f.version;
  if (v !== "v1" && v !== "v2") fail(`${LABEL[entity]}: "version" must be v1 or v2.`);
  return v;
}

function versionOpt(f: StagedFields, entity: Entity): "v1" | "v2" | null {
  const v = f.version;
  if (v === undefined || v === null || v === "") return null;
  if (v !== "v1" && v !== "v2") fail(`${LABEL[entity]}: "version" must be v1, v2 or blank.`);
  return v;
}

function nonEmpty(data: object, entity: Entity): void {
  if (Object.keys(data).length === 0) fail(`${LABEL[entity]}: nothing recognisable to update.`);
}

type Role = "OWNER" | "ADMIN" | "SUB_ADMIN";

const ROLE_LEVEL: Record<Role, number> = { OWNER: 3, ADMIN: 2, SUB_ADMIN: 1 };

function isRole(v: unknown): v is Role {
  return v === "OWNER" || v === "ADMIN" || v === "SUB_ADMIN";
}

function level(role: string): number {
  return isRole(role) ? ROLE_LEVEL[role] : 0;
}

function assertOutranks(actorRole: string, targetRole: string, what: string): void {
  if (level(actorRole) <= level(targetRole)) fail(`You don't have permission to ${what}.`);
}

type Actor = { userId: string; role: string };

function preflight(plan: StagedOp[], actor: Actor): void {
  let accounts = 0;
  for (const op of plan) {
    if (op.entity !== "adminUser") continue;
    if (op.kind !== "create" && op.kind !== "update") continue;

    assertOutranks(actor.role, "SUB_ADMIN", "manage admin accounts");

    if (op.kind === "create") {
      const role = op.fields.role;
      const assigned: Role = isRole(role) ? role : "SUB_ADMIN";
      assertOutranks(actor.role, assigned, `create a ${assigned} account`);
    }

    if (++accounts > MAX_ACCOUNT_OPS) {
      fail(`One save can only add or change ${MAX_ACCOUNT_OPS} accounts at a time.`);
    }
  }
}

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
    case "heroContent":
      return fail("There are only two hero versions — you can't add another.");
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
    case "heroContent": {
      const data: { intro?: string; tagline?: string; live?: string | null } = {};
      if (present(f, "intro")) data.intro = text(f, "intro", entity);
      if (present(f, "tagline")) data.tagline = text(f, "tagline", entity);
      if (present(f, "live")) {
        if (!bool(f, "live", entity)) fail("Make the other version live instead — one of them always is.");
        // live carries a unique index, so clear the sibling first
        await tx.heroContent.updateMany({ where: { NOT: { id } }, data: { live: null } });
        data.live = "live";
      }
      nonEmpty(data, entity);
      await tx.heroContent.update({ where: { id }, data });
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

async function deleteRow(tx: TxClient, entity: Entity, id: string, actor: Actor): Promise<void> {
  switch (entity) {
    case "heroTitle":
      await tx.heroTitle.deleteMany({ where: { id } });
      return;
    case "heroSkillBadge":
      await tx.heroSkillBadge.deleteMany({ where: { id } });
      return;
    case "heroContent":
      return fail("Hero copy can't be deleted — edit it or make the other version live.");
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
      if (id === actor.userId) fail("You cannot delete your own account.");
      const target = await tx.adminUser.findUnique({ where: { id }, select: { role: true } });
      if (!target) fail("That account no longer exists.");
      assertOutranks(actor.role, target.role, "delete this account");
      await tx.adminUser.delete({ where: { id } });
      return;
    }
  }
}

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
