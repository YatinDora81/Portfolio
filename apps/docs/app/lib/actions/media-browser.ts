"use server";

import { Prisma, prisma } from "db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomToken } from "@repo/shared/crypto";
import { logger } from "@repo/shared/logger";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_PATH_DEPTH,
  MAX_UPLOAD_BYTES,
  MIN_ALT_LENGTH,
  buildStorageKey,
  childSegmentAfter,
  displayNameOf,
  folderOfKey,
  isAllowedImageType,
  isBucketKey,
  isBucketPrefix,
  isSlugStablePath,
  isStorageKey,
  joinPrefix,
  kindOfKey,
  leafNameOf,
  parentPrefixOf,
  sanitizeFolder,
  sanitizeSegment,
  type BucketEntryDto,
  type BucketFolderDto,
  type MediaAssetDto,
} from "@repo/storage/media";
import {
  copyObject,
  createUploadUrl,
  deleteMany,
  deleteObject,
  headObject,
  listFolder,
  listKeys,
  publicUrlFor,
  putFolderMarker,
  type ListedObject,
} from "@repo/storage/r2";
import { blockedBy, referenceSources, usersOfMany, type BlockedKey } from "@/lib/media-references";
import { getSession } from "@/lib/session";

const BROWSE_MAX_PAGES = 3;
const BROWSE_BUDGET_MS = 500;
const SUBTREE_ROWS = 2000;
const PLAN_MAX_OBJECTS = 2000;
const PLAN_MAX_LISTS = 60;
const MAX_KEYS_PER_CALL = 200;
const MAX_ALLOWED_KEYS = 5000;
const MAX_MOVE_PER_CALL = 100;
const MOVE_RUN_BUDGET_MS = 20_000;
const MAX_DELETE_PER_RUN = 200;
const DELETE_RUN_BUDGET_MS = 20_000;
const DELETE_CHUNK = 50;
const DELETE_LIST_LIMIT = 1000;
const MARKER_MEMO_MS = 60_000;

const Prefix = z.string().refine(isBucketPrefix, "That is not a folder in this bucket.");

const NamedPrefix = Prefix.refine(
  (value) => value !== "",
  "The bucket root is not a folder you can act on.",
);

const BucketKey = z.string().refine(isBucketKey, "That is not an object in this bucket.");

const AltText = z
  .string()
  .trim()
  .min(MIN_ALT_LENGTH, `Alt text must be at least ${MIN_ALT_LENGTH} characters.`)
  .max(500, "Keep alt text under 500 characters.");

export interface MissingAssetDto extends MediaAssetDto {
  usedIn: string[];
}

export interface BrowseFolderResult {
  ok: boolean;
  prefix?: string;
  folders?: BucketFolderDto[];
  entries?: BucketEntryDto[];
  missing?: MissingAssetDto[];
  cursor?: string | null;
  complete?: boolean;
  slugStable?: boolean;
  scanned?: number;
  error?: string;
}

export interface CreateFolderResult {
  ok: boolean;
  prefix?: string;
  name?: string;
  created?: boolean;
  error?: string;
}

export interface SignUploadIntoResult {
  ok: boolean;
  uploadUrl?: string;
  key?: string;
  prefix?: string;
  publicUrl?: string;
  contentType?: string;
  expiresInSeconds?: number;
  error?: string;
}

export interface AdoptObjectResult {
  ok: boolean;
  asset?: MediaAssetDto;
  error?: string;
}

export interface DeleteEntriesResult {
  ok: boolean;
  deleted?: string[];
  failed?: string[];
  remaining?: number;
  done?: boolean;
  blocked?: BlockedKey[];
  rowsRemoved?: number;
  error?: string;
}

export interface PlanFolderDeleteResult {
  ok: boolean;
  prefix?: string;
  objects?: number;
  folders?: number;
  bytes?: number;
  referenced?: BlockedKey[];
  truncated?: boolean;
  error?: string;
}

export interface DeleteFolderResult {
  ok: boolean;
  deleted?: number;
  remaining?: number;
  done?: boolean;
  truncated?: boolean;
  failed?: string[];
  blocked?: BlockedKey[];
  rowsRemoved?: number;
  error?: string;
}

export interface MoveFilesResult {
  ok: boolean;
  moved?: { from: string; to: string }[];
  refused?: { key: string; reason: string }[];
  remaining?: number;
  done?: boolean;
  error?: string;
}

export interface RenameAssetResult {
  ok: boolean;
  filename?: string;
  error?: string;
}

function storageFailure(
  result: { error: string; code?: string },
  clause: string,
): { ok: false; error: string } {
  if (result.code === "NOT_CONFIGURED") return { ok: false, error: result.error };
  logger.warn("media", "storage refused a browser request", {
    clause,
    code: result.code ?? "STORAGE_ERROR",
    reason: result.error,
  });
  return { ok: false, error: `Object storage did not answer, so ${clause}.` };
}

function approvalsFor(resolved: string[], echoed: string[] | undefined): Set<string> {
  const addressed = new Set(resolved);
  return new Set((echoed ?? []).filter((key) => addressed.has(key)));
}

function toDto(row: {
  id: string;
  key: string;
  url: string;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  altText: string;
  folder: string;
  createdAt: Date;
}): MediaAssetDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

let markers: { at: number; seen: Set<string> } | null = null;

function markedRecently(prefix: string): boolean {
  if (markers && Date.now() - markers.at > MARKER_MEMO_MS) markers = null;
  return markers?.seen.has(prefix) ?? false;
}

function rememberMarker(prefix: string): void {
  if (!markers) markers = { at: Date.now(), seen: new Set<string>() };
  markers.seen.add(prefix);
}

const BrowseFolderInput = z.object({
  prefix: Prefix,
  cursor: z.string().max(4096).nullish(),
});

export async function browseFolder(input: {
  prefix: string;
  cursor?: string | null;
}): Promise<BrowseFolderResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = BrowseFolderInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That folder cannot be opened." };
  }

  const { prefix } = parsed.data;
  const from = parsed.data.cursor ?? null;

  const folders = new Set<string>();
  const objects: ListedObject[] = [];
  const started = Date.now();
  let cursor = from;
  let listedToTheEnd = false;

  for (let page = 0; page < BROWSE_MAX_PAGES; page += 1) {
    const listed = await listFolder(prefix, { cursor });
    if (!listed.ok) return storageFailure(listed, "that folder could not be read");

    for (const child of listed.data.prefixes) folders.add(child);
    objects.push(...listed.data.objects);
    cursor = listed.data.cursor;
    listedToTheEnd = listed.data.complete;

    if (listedToTheEnd) break;
    if (folders.size > 0 || objects.length > 0) break;
    if (cursor === null) break;
    if (Date.now() - started > BROWSE_BUDGET_MS) break;
  }

  const rows = await prisma.mediaAsset.findMany({
    where: prefix === "" ? {} : { key: { startsWith: prefix } },
    orderBy: { key: "asc" },
    take: SUBTREE_ROWS,
  });

  const subtree = rows.filter((row) => row.key.startsWith(prefix));
  const direct = subtree.filter((row) => parentPrefixOf(row.key) === prefix);
  for (const row of subtree) {
    if (parentPrefixOf(row.key) === prefix) continue;
    const segment = childSegmentAfter(row.key, prefix);
    if (segment !== null && segment !== "") folders.add(`${prefix}${segment}/`);
  }

  const tracked = new Map(direct.map((row) => [row.key, row]));
  const present = new Set(objects.map((object) => object.key));
  const complete = from === null && listedToTheEnd && rows.length < SUBTREE_ROWS;
  const gone = complete ? direct.filter((row) => !present.has(row.key)) : [];

  const sources = await referenceSources();
  const used = usersOfMany(sources, [...present, ...gone.map((row) => row.key)]);

  const entries: BucketEntryDto[] = objects.map((object) => {
    const row = tracked.get(object.key);
    const kind = kindOfKey(object.key);
    return {
      key: object.key,
      name: displayNameOf(object.key),
      bytes: object.bytes,
      lastModified: object.lastModified,
      kind,
      url: publicUrlFor(object.key),
      assetId: row?.id ?? null,
      altText: row?.altText ?? null,
      width: row?.width ?? null,
      height: row?.height ?? null,
      blurDataUrl: row?.blurDataUrl ?? null,
      usedIn: used.get(object.key) ?? [],
      adoptable:
        row === undefined &&
        kind === "image" &&
        object.key.includes("/") &&
        object.bytes <= MAX_UPLOAD_BYTES,
    };
  });

  return {
    ok: true,
    prefix,
    folders: [...folders].sort().map((child) => ({ prefix: child, name: leafNameOf(child) })),
    entries,
    missing: gone.map((row) => ({ ...toDto(row), usedIn: used.get(row.key) ?? [] })),
    cursor,
    complete,
    slugStable: isSlugStablePath(prefix === "" ? "" : prefix.slice(0, -1)),
    scanned: sources.length,
  };
}

const CreateFolderInput = z.object({
  prefix: Prefix,
  name: z
    .string()
    .min(1, "A folder needs a name.")
    .max(64, "Keep folder names under 64 characters."),
});

export async function createFolder(input: {
  prefix: string;
  name: string;
}): Promise<CreateFolderResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = CreateFolderInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That folder cannot be made." };
  }

  const name = sanitizeSegment(parsed.data.name);
  if (name === "") return { ok: false, error: "That folder name has no letters or numbers in it." };

  const target = joinPrefix(parsed.data.prefix, name);
  if (!isBucketPrefix(target)) {
    return { ok: false, error: `Folders can only go ${MAX_PATH_DEPTH} deep.` };
  }

  const marker = await headObject(target);
  if (marker.ok) return { ok: true, prefix: target, name, created: false };
  if (marker.code !== "NOT_FOUND") return storageFailure(marker, "the folder was not created");

  const listed = await listFolder(target, { limit: 1 });
  if (!listed.ok) return storageFailure(listed, "the folder was not created");
  if (listed.data.prefixes.length > 0 || listed.data.objects.length > 0) {
    return { ok: true, prefix: target, name, created: false };
  }

  const made = await putFolderMarker(target);
  if (!made.ok) return storageFailure(made, "the folder was not created");

  rememberMarker(target);
  logger.info("media", "created a folder", { prefix: target });

  return { ok: true, prefix: target, name, created: true };
}

const SignUploadIntoInput = z.object({
  prefix: Prefix,
  relativePath: z.string().max(400).optional(),
  filename: z.string().min(1, "A filename is required.").max(255),
  mimeType: z.enum(ALLOWED_UPLOAD_TYPES),
  bytes: z
    .number()
    .int()
    .positive("An empty file has nothing to upload.")
    .max(MAX_UPLOAD_BYTES, "Files must be 10 MB or smaller."),
});

export async function signUploadInto(input: {
  prefix: string;
  relativePath?: string;
  filename: string;
  mimeType: string;
  bytes: number;
}): Promise<SignUploadIntoResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = SignUploadIntoInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That file cannot be uploaded." };
  }

  const { prefix, filename, mimeType, bytes } = parsed.data;

  const standing = prefix === "" ? "" : prefix.slice(0, -1);
  if (standing !== "" && !isSlugStablePath(standing)) {
    const slugged = sanitizeFolder(standing);
    return {
      ok: false,
      error: `An upload into “${standing}/” would land in “${slugged}/” instead. Nothing was sent.`,
    };
  }

  const relative = (parsed.data.relativePath ?? "").split("/").slice(0, -1).join("/");
  if (relative !== "" && !isSlugStablePath(relative)) {
    const slugged = sanitizeFolder(relative);
    return {
      ok: false,
      error: `Those folders would be renamed to “${slugged}”. Nothing was sent.`,
    };
  }

  const destination = relative === "" ? prefix : `${prefix}${relative}/`;
  if (destination === "") {
    return { ok: false, error: "The bucket root cannot hold an upload — open a folder first." };
  }
  if (!isBucketPrefix(destination)) {
    return {
      ok: false,
      error: `Folders can only go ${MAX_PATH_DEPTH} deep, so that file has nowhere to land.`,
    };
  }

  let walked = prefix;
  for (const segment of relative === "" ? [] : relative.split("/")) {
    walked = joinPrefix(walked, segment);
    if (markedRecently(walked)) continue;
    const made = await putFolderMarker(walked);
    if (!made.ok) return storageFailure(made, "the upload could not start");
    rememberMarker(walked);
  }

  const key = buildStorageKey(destination.slice(0, -1), filename, mimeType, randomToken(4));
  if (!isStorageKey(key)) return { ok: false, error: "That folder cannot hold an upload." };

  const signed = await createUploadUrl(key, mimeType, MAX_UPLOAD_BYTES);
  if (!signed.ok) return storageFailure(signed, "the upload could not start");

  logger.info("media", "signed an upload", { key, bytes, mimeType });

  return {
    ok: true,
    uploadUrl: signed.data.uploadUrl,
    key,
    prefix: destination,
    publicUrl: publicUrlFor(key),
    contentType: signed.data.contentType,
    expiresInSeconds: signed.data.expiresInSeconds,
  };
}

const AdoptObjectInput = z.object({
  key: BucketKey,
  altText: AltText,
  width: z.number().int().positive().max(40000).optional(),
  height: z.number().int().positive().max(40000).optional(),
});

export async function adoptObject(input: {
  key: string;
  altText: string;
  width?: number;
  height?: number;
}): Promise<AdoptObjectResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = AdoptObjectInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That file cannot be adopted." };
  }

  const { key, altText, width, height } = parsed.data;
  if (!key.includes("/")) {
    return {
      ok: false,
      error: "A file at the bucket root cannot join the library — move it into a folder first.",
    };
  }

  const head = await headObject(key);
  if (!head.ok) {
    if (head.code !== "NOT_FOUND") return storageFailure(head, "nothing was adopted");
    return { ok: false, error: "There is no file at that key any more." };
  }

  const mimeType = head.data.contentType;
  if (mimeType === null || !isAllowedImageType(mimeType)) {
    return {
      ok: false,
      error: "Only images can join the library. The file has been left exactly as it is.",
    };
  }
  if (head.data.bytes > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is over 10 MB. It has been left exactly as it is." };
  }

  const shared = {
    url: publicUrlFor(key),
    filename: leafNameOf(key),
    mimeType,
    bytes: head.data.bytes,
    width: width ?? null,
    height: height ?? null,
    altText,
  };

  const asset = await prisma.mediaAsset.upsert({
    where: { key },
    create: { key, folder: folderOfKey(key), uploadedById: session.userId, ...shared },
    update: shared,
  });

  logger.info("media", "adopted an object", { key });

  revalidatePath("/media");
  return { ok: true, asset: toDto(asset) };
}

const DeleteEntriesInput = z.object({
  keys: z
    .array(BucketKey)
    .min(1, "Nothing was selected.")
    .max(MAX_KEYS_PER_CALL, `Delete at most ${MAX_KEYS_PER_CALL} files at a time.`),
  allowReferenced: z.array(z.string()).max(MAX_ALLOWED_KEYS).optional(),
});

export async function deleteEntries(input: {
  keys: string[];
  allowReferenced?: string[];
}): Promise<DeleteEntriesResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = DeleteEntriesInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those files cannot be deleted." };
  }

  const keys = [...new Set(parsed.data.keys)];
  const allowed = approvalsFor(keys, parsed.data.allowReferenced);

  const sources = await referenceSources(true);
  const blocked = blockedBy(sources, keys).filter((entry) => !allowed.has(entry.key));
  if (blocked.length > 0) {
    return {
      ok: false,
      blocked,
      error:
        blocked.length === 1
          ? "Something on the site still points at that file. Nothing has been deleted."
          : `${blocked.length} of those files are still in use. Nothing has been deleted.`,
    };
  }

  const removed = await deleteMany(keys);
  if (!removed.ok) return storageFailure(removed, "nothing was deleted");

  const { deleted, failed } = removed.data;
  const rows =
    deleted.length > 0
      ? await prisma.mediaAsset.deleteMany({ where: { key: { in: deleted } } })
      : { count: 0 };

  logger.info("media", "deleted objects", {
    count: deleted.length,
    failed: failed.length,
    rows: rows.count,
  });

  if (rows.count > 0) revalidatePath("/media");

  const remaining = keys.length - deleted.length;

  return {
    ok: failed.length === 0,
    deleted,
    failed: failed.map((entry) => entry.key),
    remaining,
    done: remaining === 0 && failed.length === 0,
    rowsRemoved: rows.count,
    error: failed.length > 0 ? `${failed.length} of those files could not be deleted.` : undefined,
  };
}

export async function planFolderDelete(input: { prefix: string }): Promise<PlanFolderDeleteResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = z.object({ prefix: NamedPrefix }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That folder cannot be read." };
  }

  const root = parsed.data.prefix;

  const enumerated = await listKeys(root, PLAN_MAX_OBJECTS);
  if (!enumerated.ok) return storageFailure(enumerated, "that folder could not be measured");

  const doomed = enumerated.data.keys.filter((key) => key.startsWith(root));

  const sizes = new Map<string, number>();
  const queue = [root];
  const seen = new Set(queue);
  let lists = 0;
  let cutShort = false;

  while (queue.length > 0 && !cutShort) {
    const at = queue.shift();
    if (at === undefined) break;

    let cursor: string | null = null;
    for (;;) {
      const listed = await listFolder(at, { cursor });
      lists += 1;
      if (!listed.ok) return storageFailure(listed, "that folder could not be measured");

      for (const child of listed.data.prefixes) {
        if (seen.has(child)) continue;
        seen.add(child);
        queue.push(child);
      }
      for (const object of listed.data.objects) sizes.set(object.key, object.bytes);
      cursor = listed.data.cursor;

      if (sizes.size >= PLAN_MAX_OBJECTS || lists >= PLAN_MAX_LISTS) {
        cutShort = true;
        break;
      }
      if (listed.data.complete) break;
      if (cursor === null) {
        cutShort = true;
        break;
      }
    }
  }

  const sources = await referenceSources();

  return {
    ok: true,
    prefix: root,
    objects: doomed.length,
    folders: seen.size - 1,
    bytes: doomed.reduce((total, key) => total + (sizes.get(key) ?? 0), 0),
    referenced: blockedBy(sources, doomed),
    truncated:
      enumerated.data.truncated || enumerated.data.partial || cutShort || queue.length > 0,
  };
}

const DeleteFolderInput = z.object({
  prefix: NamedPrefix,
  confirmName: z.string().min(1, "Type the folder's name to confirm."),
  allowReferenced: z.array(z.string()).max(MAX_ALLOWED_KEYS).optional(),
});

export async function deleteFolder(input: {
  prefix: string;
  confirmName: string;
  allowReferenced?: string[];
}): Promise<DeleteFolderResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = DeleteFolderInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That folder cannot be deleted." };
  }

  const { prefix, confirmName } = parsed.data;
  const name = leafNameOf(prefix);
  if (confirmName.trim() !== name) {
    return { ok: false, error: `Type “${name}” to confirm. None of this can be undone.` };
  }

  const listed = await listKeys(prefix, DELETE_LIST_LIMIT);
  if (!listed.ok) return storageFailure(listed, "nothing was deleted");

  const keys = listed.data.keys.filter((key) => key.startsWith(prefix));
  const allowed = approvalsFor(keys, parsed.data.allowReferenced);

  const sources = await referenceSources(true);
  const blocked = blockedBy(sources, keys).filter((entry) => !allowed.has(entry.key));
  if (blocked.length > 0) {
    return {
      ok: false,
      blocked,
      error:
        blocked.length === 1
          ? "One file in that folder is still in use. Nothing has been deleted."
          : `${blocked.length} files in that folder are still in use. Nothing has been deleted.`,
    };
  }

  const rest = keys.filter((key) => key !== prefix);
  const batch = rest.length > 0 ? rest.slice(0, MAX_DELETE_PER_RUN) : keys;

  const started = Date.now();
  const deleted: string[] = [];
  const failed: { key: string; error: string }[] = [];

  for (let at = 0; at < batch.length; at += DELETE_CHUNK) {
    if (Date.now() - started > DELETE_RUN_BUDGET_MS) break;
    const removed = await deleteMany(batch.slice(at, at + DELETE_CHUNK));
    if (!removed.ok) return storageFailure(removed, "nothing was deleted");
    deleted.push(...removed.data.deleted);
    failed.push(...removed.data.failed);
  }

  const rows =
    deleted.length > 0
      ? await prisma.mediaAsset.deleteMany({ where: { key: { in: deleted } } })
      : { count: 0 };

  logger.info("media", "deleted a folder batch", {
    prefix,
    count: deleted.length,
    failed: failed.length,
    rows: rows.count,
  });

  if (rows.count > 0) revalidatePath("/media");

  const remaining = Math.max(0, keys.length - deleted.length);
  const partial = listed.data.truncated || listed.data.partial;

  return {
    ok: failed.length === 0,
    deleted: deleted.length,
    remaining,
    done: remaining === 0 && failed.length === 0 && !partial,
    truncated: partial,
    failed: failed.map((entry) => entry.key),
    rowsRemoved: rows.count,
    error: failed.length > 0 ? `${failed.length} of those files could not be deleted.` : undefined,
  };
}

const MoveFilesInput = z.object({
  keys: z
    .array(BucketKey)
    .min(1, "Nothing was selected.")
    .max(MAX_MOVE_PER_CALL, `Move at most ${MAX_MOVE_PER_CALL} files at a time.`),
  to: NamedPrefix,
});

interface Relocation {
  moved: boolean;
  changed: number;
  reason: string | null;
}

const claimed = new Map<string, Promise<void>>();

async function underClaim(
  destination: string,
  run: () => Promise<Relocation>,
): Promise<Relocation> {
  const ahead = claimed.get(destination);
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = ahead ? ahead.then(() => held) : held;
  claimed.set(destination, queued);

  if (ahead) await ahead;
  try {
    return await run();
  } finally {
    release();
    if (claimed.get(destination) === queued) claimed.delete(destination);
  }
}

async function relocate(key: string, destination: string): Promise<Relocation> {
  const head = await headObject(destination);
  if (head.ok) return { moved: false, changed: 0, reason: "A file of that name is already there." };
  if (head.code !== "NOT_FOUND") {
    return { moved: false, changed: 0, reason: storageFailure(head, "it was left alone").error };
  }

  const occupied = await prisma.mediaAsset.findUnique({
    where: { key: destination },
    select: { id: true },
  });
  if (occupied) {
    return { moved: false, changed: 0, reason: "The library already has a row at that key." };
  }

  const copied = await copyObject(key, destination);
  if (!copied.ok) {
    return {
      moved: false,
      changed: 0,
      reason:
        copied.code === "NOT_FOUND"
          ? "It is not in the bucket any more."
          : storageFailure(copied, "the copy did not happen").error,
    };
  }

  let changed = 0;
  try {
    const updated = await prisma.mediaAsset.updateMany({
      where: { key },
      data: { key: destination, url: publicUrlFor(destination), folder: folderOfKey(destination) },
    });
    changed = updated.count;
  } catch (e) {
    await deleteObject(destination);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { moved: false, changed: 0, reason: "The library already has a row at that key." };
    }
    logger.error("media", "a move was rolled back", { key, err: String(e) });
    return {
      moved: false,
      changed: 0,
      reason: "The move could not be recorded, so the copy was removed.",
    };
  }

  const swept = await deleteObject(key);
  if (!swept.ok) {
    logger.warn("media", "a moved file left its original behind", {
      key,
      destination,
      code: swept.code ?? "STORAGE_ERROR",
    });
    const stranded = `The original could not be removed, so it is now at “${destination}” as well.`;
    return { moved: false, changed, reason: stranded };
  }

  return { moved: true, changed, reason: null };
}

export async function moveFiles(input: { keys: string[]; to: string }): Promise<MoveFilesResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = MoveFilesInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those files cannot be moved." };
  }

  const to = parsed.data.to;
  const keys = [...new Set(parsed.data.keys)];

  const standing = to.slice(0, -1);
  if (!isSlugStablePath(standing)) {
    const slugged = sanitizeFolder(standing);
    return {
      ok: false,
      error: `A move into “${standing}/” would land in “${slugged}/” instead. Nothing was moved.`,
    };
  }

  const sources = await referenceSources(true);
  const used = usersOfMany(sources, keys);

  const moved: { from: string; to: string }[] = [];
  const refused: { key: string; reason: string }[] = [];
  const started = Date.now();
  let processed = 0;
  let changed = 0;

  for (const key of keys) {
    if (Date.now() - started > MOVE_RUN_BUDGET_MS) break;
    processed += 1;

    const destination = `${to}${leafNameOf(key)}`;
    if (destination === key) {
      refused.push({ key, reason: "It is already in that folder." });
      continue;
    }
    if (!isBucketKey(destination)) {
      refused.push({ key, reason: `Keys can only go ${MAX_PATH_DEPTH} folders deep.` });
      continue;
    }
    if ((used.get(key) ?? []).length > 0) {
      refused.push({
        key,
        reason: "Something on the site points at it, and moving it would break that page.",
      });
      continue;
    }

    const outcome = await underClaim(destination, () => relocate(key, destination));
    changed += outcome.changed;

    if (outcome.moved) moved.push({ from: key, to: destination });
    else refused.push({ key, reason: outcome.reason ?? "It was left exactly as it is." });
  }

  logger.info("media", "moved files", { to, count: moved.length, refused: refused.length });

  if (changed > 0) revalidatePath("/media");

  const remaining = keys.length - processed;
  const trouble = [
    refused.length > 0 ? `${refused.length} of those files were not moved.` : "",
    remaining > 0
      ? `${remaining} more were not reached before the run ran out of time — move them again.`
      : "",
  ].filter((part) => part !== "");

  return {
    ok: refused.length === 0 && remaining === 0,
    moved,
    refused,
    remaining,
    done: refused.length === 0 && remaining === 0,
    error: trouble.length > 0 ? trouble.join(" ") : undefined,
  };
}

const RenameAssetInput = z.object({
  id: z.string().uuid(),
  filename: z
    .string()
    .trim()
    .min(1, "A file needs a name.")
    .max(255, "Keep filenames under 255 characters."),
});

export async function renameAsset(input: {
  id: string;
  filename: string;
}): Promise<RenameAssetResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = RenameAssetInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That name cannot be saved." };
  }

  const updated = await prisma.mediaAsset.updateMany({
    where: { id: parsed.data.id },
    data: { filename: parsed.data.filename },
  });
  if (updated.count === 0) return { ok: false, error: "That asset no longer exists." };

  revalidatePath("/media");
  return { ok: true, filename: parsed.data.filename };
}
