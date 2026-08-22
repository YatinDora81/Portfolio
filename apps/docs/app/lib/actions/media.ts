"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomToken } from "@repo/shared/crypto";
import { logger } from "@repo/shared/logger";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  MIN_ALT_LENGTH,
  buildStorageKey,
  folderOfKey,
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

const MimeType = z.enum(ALLOWED_IMAGE_TYPES);

const StorageKey = z.string().refine(isStorageKey, "That is not a key this server issued.");

const SignUploadInput = z.object({
  filename: z.string().min(1, "A filename is required.").max(255),
  mimeType: MimeType,
  bytes: z
    .number()
    .int()
    .positive("An empty file has nothing to upload.")
    .max(MAX_UPLOAD_BYTES, "Images must be 10 MB or smaller."),
  folder: z.string().max(32).optional(),
});

const AltText = z
  .string()
  .trim()
  .min(MIN_ALT_LENGTH, `Alt text must be at least ${MIN_ALT_LENGTH} characters.`)
  .max(500, "Keep alt text under 500 characters.");

const CompleteUploadInput = z.object({
  key: StorageKey,
  filename: z.string().min(1).max(255),
  mimeType: MimeType,
  altText: AltText,
  width: z.number().int().positive().max(40000).optional(),
  height: z.number().int().positive().max(40000).optional(),
  blurDataUrl: z
    .string()
    .startsWith("data:image/", "The placeholder must be an image data URL.")
    .max(4096, "The placeholder is too large — it should be a ~10px thumbnail.")
    .optional(),
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

/**
 * A presigned URL is a temporary capability to write into the bucket, so type
 * and size are checked here, before one exists.
 */
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

/**
 * Register bytes the browser says it uploaded. The HEAD is not a formality:
 * without it the client decides what rows exist, and it is the only place the
 * real size can be read. Upserts on `key` so a retry is idempotent.
 */
export async function completeUpload(input: {
  key: string;
  filename: string;
  mimeType: string;
  altText: string;
  width?: number;
  height?: number;
  blurDataUrl?: string;
}): Promise<CompleteUploadResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = CompleteUploadInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That upload cannot be saved." };
  }

  const { key, filename, mimeType, altText, width, height, blurDataUrl } = parsed.data;

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

  // The object in the bucket is not the object that was approved. Refuse the row
  // and take the object with it, rather than leaving bytes nothing points at.
  if (head.data.bytes > MAX_UPLOAD_BYTES) {
    await deleteObject(key);
    logger.warn("media", "discarded an oversized upload", { key, bytes: head.data.bytes });
    return { ok: false, error: "The file that arrived is larger than 10 MB. It has been removed." };
  }
  if (head.data.contentType !== null && head.data.contentType !== mimeType) {
    await deleteObject(key);
    logger.warn("media", "discarded a type-mismatched upload", { key });
    return {
      ok: false,
      error: "The file that arrived is not the type that was approved. It has been removed.",
    };
  }

  const shared = {
    url: publicUrlFor(key),
    filename,
    mimeType,
    bytes: head.data.bytes,
    width: width ?? null,
    height: height ?? null,
    blurDataUrl: blurDataUrl ?? null,
    altText,
  };

  const asset = await prisma.mediaAsset.upsert({
    where: { key },
    create: {
      key,
      // From the key, because that folder is the one that was sanitized and signed.
      folder: folderOfKey(key),
      uploadedById: session.userId,
      ...shared,
    },
    update: shared,
  });

  revalidatePath("/media");
  return { ok: true, asset: toDto(asset) };
}

/**
 * Drop bytes uploaded but never given alt text, so an abandoned drop leaves no
 * permanent invisible object. Refuses a key a row already owns — that is
 * `deleteAsset`, with a confirm.
 */
export async function discardUpload(input: {
  key: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = z.object({ key: StorageKey }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a key this server issued." };

  const existing = await prisma.mediaAsset.findUnique({
    where: { key: parsed.data.key },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "That upload is already saved — delete it from the library instead." };
  }

  const removed = await deleteObject(parsed.data.key);
  if (!removed.ok) return { ok: false, error: removed.error };
  return { ok: true };
}

/**
 * Object first. If the object cannot be removed the row stays — it is the only
 * visible record that the object exists.
 */
export async function deleteAsset(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a valid asset." };

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, key: true },
  });
  if (!asset) return { ok: false, error: "That asset no longer exists." };

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
