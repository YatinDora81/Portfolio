"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomToken } from "@repo/shared/crypto";
import { logger } from "@repo/shared/logger";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  MIN_ALT_LENGTH,
  buildStorageKey,
  folderOfKey,
  isAllowedImageType,
  isStorageKey,
  type MediaAssetDto,
} from "@repo/storage/media";
import {
  createUploadUrl,
  deleteObject,
  headObject,
  publicUrlFor,
} from "@repo/storage/r2";
import { getSession } from "@/lib/session";
import { blockedBy, referenceSources, type BlockedKey } from "@/lib/media-references";

const MimeType = z.enum(ALLOWED_UPLOAD_TYPES);

const StorageKey = z.string().refine(isStorageKey, "That is not a key this server issued.");

const SignUploadInput = z.object({
  filename: z.string().min(1, "A filename is required.").max(255),
  mimeType: MimeType,
  bytes: z
    .number()
    .int()
    .positive("An empty file has nothing to upload.")
    .max(MAX_UPLOAD_BYTES, "Files must be 10 MB or smaller."),
  folder: z.string().max(200).optional(),
});

const ALT_TOO_SHORT = `Alt text must be at least ${MIN_ALT_LENGTH} characters.`;

const AltText = z
  .string()
  .trim()
  .min(MIN_ALT_LENGTH, ALT_TOO_SHORT)
  .max(500, "Keep alt text under 500 characters.");

const AllowReferencedKeys = z.array(z.string()).max(8).optional();

const CompleteUploadInput = z
  .object({
    key: StorageKey,
    allowReferenced: AllowReferencedKeys,
    filename: z.string().min(1).max(255),
    mimeType: MimeType,
    altText: z.string().trim().max(500, "Keep alt text under 500 characters."),
    width: z.number().int().positive().max(40000).optional(),
    height: z.number().int().positive().max(40000).optional(),
    blurDataUrl: z
      .string()
      .startsWith("data:image/", "The placeholder must be an image data URL.")
      .max(4096, "The placeholder is too large — it should be a ~10px thumbnail.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (isAllowedImageType(value.mimeType) && value.altText.length < MIN_ALT_LENGTH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["altText"], message: ALT_TOO_SHORT });
    }
  });

export interface SignUploadResult {
  ok: boolean;
  uploadUrl?: string;
  key?: string;
  publicUrl?: string;
  contentType?: string;
  expiresInSeconds?: number;
  error?: string;
}

export interface CompleteUploadResult {
  ok: boolean;
  asset?: MediaAssetDto;
  blocked?: BlockedKey[];
  error?: string;
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

export async function signUpload(input: {
  filename: string;
  mimeType: string;
  bytes: number;
  folder?: string;
}): Promise<SignUploadResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = SignUploadInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That file cannot be uploaded." };
  }

  const { filename, mimeType, bytes, folder } = parsed.data;
  const key = buildStorageKey(folder, filename, mimeType, randomToken(4));
  if (!isStorageKey(key)) return { ok: false, error: "That folder cannot hold an upload." };

  const signed = await createUploadUrl(key, mimeType, MAX_UPLOAD_BYTES);
  if (!signed.ok) return { ok: false, error: signed.error };

  logger.info("media", "signed an upload", { key, bytes, mimeType });

  return {
    ok: true,
    uploadUrl: signed.data.uploadUrl,
    key,
    publicUrl: publicUrlFor(key),
    contentType: signed.data.contentType,
    expiresInSeconds: signed.data.expiresInSeconds,
  };
}

async function discardMismatchedLanding(
  key: string,
  allowed: ReadonlySet<string>,
  problem: string,
): Promise<{ removed: boolean; blocked?: BlockedKey[]; error: string }> {
  const saved = await prisma.mediaAsset.findUnique({ where: { key }, select: { id: true } });
  if (saved) {
    return {
      removed: false,
      error: `${problem} A saved asset already lives at that key, so the stored file has been kept — delete it from the library if you meant to replace it.`,
    };
  }

  if (!allowed.has(key)) {
    const blocked = blockedBy(await referenceSources(true), [key]);
    if (blocked.length > 0) {
      return {
        removed: false,
        blocked,
        error: `${problem} It is in use on the site, so it was kept.`,
      };
    }
  }

  const removed = await deleteObject(key);
  if (!removed.ok && removed.code !== "NOT_FOUND") {
    return { removed: false, error: `${problem} ${removed.error} It is still in the bucket.` };
  }
  return { removed: true, error: `${problem} It has been removed.` };
}

export async function completeUpload(input: {
  key: string;
  filename: string;
  mimeType: string;
  altText: string;
  width?: number;
  height?: number;
  blurDataUrl?: string;
  allowReferenced?: string[];
}): Promise<CompleteUploadResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = CompleteUploadInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That upload cannot be saved." };
  }

  const { key, filename, mimeType, altText, width, height, blurDataUrl } = parsed.data;
  const allowed = new Set(parsed.data.allowReferenced ?? []);

  const head = await headObject(key);
  if (!head.ok) {
    return {
      ok: false,
      error:
        head.code === "NOT_FOUND"
          ? "Nothing was found at that key — the upload did not finish. Try it again."
          : head.error,
    };
  }

  if (head.data.bytes > MAX_UPLOAD_BYTES) {
    const outcome = await discardMismatchedLanding(
      key,
      allowed,
      "The file that arrived is larger than 10 MB.",
    );
    if (outcome.removed) {
      logger.warn("media", "discarded an oversized upload", { key, bytes: head.data.bytes });
    }
    return { ok: false, blocked: outcome.blocked, error: outcome.error };
  }
  if (head.data.contentType !== null && head.data.contentType !== mimeType) {
    const outcome = await discardMismatchedLanding(
      key,
      allowed,
      "The file that arrived is not the type that was approved.",
    );
    if (outcome.removed) logger.warn("media", "discarded a type-mismatched upload", { key });
    return { ok: false, blocked: outcome.blocked, error: outcome.error };
  }

  const description = altText === "" ? filename : altText;

  const shared = {
    url: publicUrlFor(key),
    filename,
    mimeType,
    bytes: head.data.bytes,
    width: width ?? null,
    height: height ?? null,
    blurDataUrl: blurDataUrl ?? null,
    altText: description,
  };

  const asset = await prisma.mediaAsset.upsert({
    where: { key },
    create: {
      key,
      folder: folderOfKey(key),
      uploadedById: session.userId,
      ...shared,
    },
    update: shared,
  });

  revalidatePath("/media");
  return { ok: true, asset: toDto(asset) };
}

export async function discardUpload(input: {
  key: string;
  allowReferenced?: string[];
}): Promise<{ ok: boolean; blocked?: BlockedKey[]; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = z
    .object({ key: StorageKey, allowReferenced: AllowReferencedKeys })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a key this server issued." };

  const { key } = parsed.data;
  const allowed = new Set(parsed.data.allowReferenced ?? []);

  const existing = await prisma.mediaAsset.findUnique({ where: { key }, select: { id: true } });
  if (existing) {
    return { ok: false, error: "That upload is already saved — delete it from the library instead." };
  }

  if (!allowed.has(key)) {
    const blocked = blockedBy(await referenceSources(true), [key]);
    if (blocked.length > 0) {
      return { ok: false, blocked, error: "That file is in use on the site, so it was kept." };
    }
  }

  const removed = await deleteObject(key);
  if (!removed.ok) return { ok: false, error: removed.error };
  return { ok: true };
}

export async function deleteAsset(input: {
  id: string;
  allowReferenced?: string[];
}): Promise<{ ok: boolean; blocked?: BlockedKey[]; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = z
    .object({ id: z.string().uuid(), allowReferenced: AllowReferencedKeys })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a valid asset." };

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, key: true },
  });
  if (!asset) return { ok: false, error: "That asset no longer exists." };

  const allowed = new Set(parsed.data.allowReferenced ?? []);
  if (!allowed.has(asset.key)) {
    const blocked = blockedBy(await referenceSources(true), [asset.key]);
    if (blocked.length > 0) {
      return { ok: false, blocked, error: "That file is in use on the site, so it was kept." };
    }
  }

  const removed = await deleteObject(asset.key);
  if (!removed.ok && removed.code !== "NOT_FOUND") {
    return {
      ok: false,
      error: `${removed.error} The row has been kept, so the file is still accounted for.`,
    };
  }

  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  logger.info("media", "deleted an asset", { key: asset.key });

  revalidatePath("/media");
  return { ok: true };
}

const AltTextInput = z.object({ id: z.string().uuid(), altText: AltText });

export async function updateAltText(input: {
  id: string;
  altText: string;
}): Promise<{ ok: boolean; altText?: string; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = AltTextInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That alt text cannot be saved." };
  }

  const updated = await prisma.mediaAsset.updateMany({
    where: { id: parsed.data.id },
    data: { altText: parsed.data.altText },
  });
  if (updated.count === 0) return { ok: false, error: "That asset no longer exists." };

  revalidatePath("/media");
  return { ok: true, altText: parsed.data.altText };
}
