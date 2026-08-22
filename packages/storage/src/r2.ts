import "server-only";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@repo/config/env";
import { err, ok, type Result } from "@repo/shared/result";

export type StorageCode = "NOT_CONFIGURED" | "NOT_FOUND" | "STORAGE_ERROR";

export const REQUIRED_R2_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

export const UPLOAD_URL_TTL_SECONDS = 300;

export function missingStorageVars(): string[] {
  return REQUIRED_R2_VARS.filter((key) => {
    const value = env[key];
    return value === undefined || value === "";
  });
}

export function isStorageConfigured(): boolean {
  return missingStorageVars().length === 0;
}

interface Bound {
  client: S3Client;
  bucket: string;
}

let bound: Bound | null = null;

// Lazy, never at module scope: this file is imported by a page that must still
// render in an environment with no R2 credentials at all.
function connect(): Bound | null {
  if (bound) return bound;

  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  bound = {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return bound;
}

function notConfigured<T>(): Result<T> {
  const missing = missingStorageVars();
  return err<T>(
    `Object storage is not configured — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} unset.`,
    "NOT_CONFIGURED",
  );
}

function reason(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "R2 refused the request.";
}

/**
 * With no CDN_BASE_URL this returns a root-relative path, which is what the rest
 * of this database already stores and what `cdnUrl()` resolves against
 * NEXT_PUBLIC_CDN_URL at render. Setting it pins an absolute origin instead.
 */
export function publicUrlFor(key: string): string {
  const base = env.CDN_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${key}` : `/${key}`;
}

export interface SignedUpload {
  uploadUrl: string;
  /** The browser MUST send this header; it is part of the signature. */
  contentType: string;
  expiresInSeconds: number;
  maxBytes: number;
}

/**
 * A presigned PUT has no content-length-range condition, so `maxBytes` is only
 * the ceiling the caller must already have checked the declared size against —
 * `headObject` is what verifies the size that actually landed.
 */
export async function createUploadUrl(
  key: string,
  contentType: string,
  maxBytes: number,
): Promise<Result<SignedUpload>> {
  const conn = connect();
  if (!conn) return notConfigured<SignedUpload>();

  try {
    const uploadUrl = await getSignedUrl(
      conn.client,
      new PutObjectCommand({ Bucket: conn.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
    );
    return ok({ uploadUrl, contentType, expiresInSeconds: UPLOAD_URL_TTL_SECONDS, maxBytes });
  } catch (e) {
    return err<SignedUpload>(reason(e), "STORAGE_ERROR");
  }
}

export interface ObjectHead {
  bytes: number;
  contentType: string | null;
}

export async function headObject(key: string): Promise<Result<ObjectHead>> {
  const conn = connect();
  if (!conn) return notConfigured<ObjectHead>();

  try {
    const res = await conn.client.send(
      new HeadObjectCommand({ Bucket: conn.bucket, Key: key }),
    );
    return ok({ bytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null });
  } catch (e) {
    // "The client lied" and "the connection broke" are different problems upstream.
    const name = e instanceof Error ? e.name : "";
    if (name === "NotFound" || name === "NoSuchKey") {
      return err<ObjectHead>("No object exists at that key.", "NOT_FOUND");
    }
    return err<ObjectHead>(reason(e), "STORAGE_ERROR");
  }
}

export async function deleteObject(key: string): Promise<Result<null>> {
  const conn = connect();
  if (!conn) return notConfigured<null>();

  try {
    await conn.client.send(new DeleteObjectCommand({ Bucket: conn.bucket, Key: key }));
    return ok(null);
  } catch (e) {
    return err<null>(reason(e), "STORAGE_ERROR");
  }
}
