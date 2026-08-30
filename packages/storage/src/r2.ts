import "server-only";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  paginateListObjectsV2,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@repo/config/env";
import { err, ok, type Result } from "@repo/shared/result";

export type StorageCode = "NOT_CONFIGURED" | "NOT_FOUND" | "PARTIAL" | "STORAGE_ERROR";

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
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
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

export function publicUrlFor(key: string): string {
  const base = env.CDN_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${key}` : `/${key}`;
}

export interface SignedUpload {
  uploadUrl: string;
  contentType: string;
  expiresInSeconds: number;
  maxBytes: number;
}

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
    const name = e instanceof Error ? e.name : "";
    if (name === "NotFound" || name === "NoSuchKey") {
      return err<ObjectHead>("No object exists at that key.", "NOT_FOUND");
    }
    return err<ObjectHead>(reason(e), "STORAGE_ERROR");
  }
}

const LIST_PAGE_SIZE = 1000;

function isFolderMarker(key: string): boolean {
  return key.endsWith("/");
}

export interface ListedObject {
  key: string;
  bytes: number;
  lastModified: string | null;
  etag: string | null;
}

export interface FolderListing {
  prefixes: string[];
  objects: ListedObject[];
  cursor: string | null;
  complete: boolean;
}

export interface ListFolderOptions {
  cursor?: string | null;
  limit?: number;
}

export async function listFolder(
  prefix: string,
  opts: ListFolderOptions = {},
): Promise<Result<FolderListing>> {
  const conn = connect();
  if (!conn) return notConfigured<FolderListing>();

  try {
    const res = await conn.client.send(
      new ListObjectsV2Command({
        Bucket: conn.bucket,
        Prefix: prefix,
        Delimiter: "/",
        MaxKeys: opts.limit ?? LIST_PAGE_SIZE,
        ContinuationToken: opts.cursor ?? undefined,
      }),
    );

    const prefixes: string[] = [];
    for (const entry of res.CommonPrefixes ?? []) {
      const value = entry.Prefix;
      if (!value || value === prefix) continue;
      prefixes.push(value);
    }

    const objects: ListedObject[] = [];
    for (const entry of res.Contents ?? []) {
      const key = entry.Key;
      if (!key || key === prefix || isFolderMarker(key)) continue;
      objects.push({
        key,
        bytes: entry.Size ?? 0,
        lastModified: entry.LastModified?.toISOString() ?? null,
        etag: entry.ETag ?? null,
      });
    }

    const truncated = res.IsTruncated === true;
    return ok({
      prefixes,
      objects,
      cursor: truncated ? (res.NextContinuationToken ?? null) : null,
      complete: !truncated,
    });
  } catch (e) {
    return err<FolderListing>(reason(e), "STORAGE_ERROR");
  }
}

export interface KeyListing {
  keys: string[];
  truncated: boolean;
  partial: boolean;
}

export async function listKeys(
  prefix: string,
  limit = LIST_PAGE_SIZE,
): Promise<Result<KeyListing>> {
  const conn = connect();
  if (!conn) return notConfigured<KeyListing>();

  const keys: string[] = [];
  let truncated = false;

  try {
    const pages = paginateListObjectsV2(
      { client: conn.client, pageSize: Math.min(limit, LIST_PAGE_SIZE) },
      { Bucket: conn.bucket, Prefix: prefix },
    );

    for await (const page of pages) {
      for (const entry of page.Contents ?? []) {
        const key = entry.Key;
        if (!key) continue;
        if (keys.length >= limit) {
          truncated = true;
          break;
        }
        keys.push(key);
      }
      if (truncated) break;
    }

    return ok({ keys, truncated, partial: false });
  } catch (e) {
    if (keys.length === 0) return err<KeyListing>(reason(e), "STORAGE_ERROR");
    return ok({ keys, truncated: true, partial: true });
  }
}

export async function putFolderMarker(prefix: string): Promise<Result<null>> {
  const conn = connect();
  if (!conn) return notConfigured<null>();

  try {
    await conn.client.send(
      new PutObjectCommand({
        Bucket: conn.bucket,
        Key: prefix,
        Body: "",
        ContentLength: 0,
        ContentType: "application/x-directory",
      }),
    );
    return ok(null);
  } catch (e) {
    return err<null>(reason(e), "STORAGE_ERROR");
  }
}

function encodePathSegments(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export async function copyObject(from: string, to: string): Promise<Result<null>> {
  const conn = connect();
  if (!conn) return notConfigured<null>();

  const source = encodePathSegments(from);

  try {
    await conn.client.send(
      new CopyObjectCommand({
        Bucket: conn.bucket,
        Key: to,
        CopySource: `${conn.bucket}/${source}`,
      }),
    );
    return ok(null);
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotFound" || name === "NoSuchKey") {
      return err<null>("No object exists at that key.", "NOT_FOUND");
    }
    return err<null>(reason(e), "STORAGE_ERROR");
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

export interface DeleteReport {
  ok: boolean;
  done: boolean;
  deleted: string[];
  failed: { key: string; error: string }[];
  remaining: number;
}

export async function deleteMany(
  keys: string[],
  concurrency = 6,
): Promise<Result<DeleteReport>> {
  const conn = connect();
  if (!conn) return notConfigured<DeleteReport>();

  const deleted: string[] = [];
  const failed: DeleteReport["failed"] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const key = keys[next++];
      if (key === undefined) return;
      try {
        await conn.client.send(new DeleteObjectCommand({ Bucket: conn.bucket, Key: key }));
        deleted.push(key);
      } catch (e) {
        failed.push({ key, error: reason(e) });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));

  const remaining = Math.max(0, keys.length - deleted.length - failed.length);
  return ok({
    ok: failed.length === 0,
    done: remaining === 0 && failed.length === 0,
    deleted,
    failed,
    remaining,
  });
}
