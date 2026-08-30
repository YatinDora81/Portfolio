export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export const ALLOWED_DOC_TYPES = [
  "text/markdown",
  "application/pdf",
  "text/plain",
  "application/json",
  "text/csv",
] as const;

export const ALLOWED_UPLOAD_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export type AllowedDocType = (typeof ALLOWED_DOC_TYPES)[number];
export type AllowedUploadType = AllowedImageType | AllowedDocType;

const EXTENSIONS: Record<AllowedUploadType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "text/markdown": "md",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/json": "json",
  "text/csv": "csv",
};

const SCRIPTABLE_EXTENSIONS = new Set([
  "svg", "html", "htm", "xhtml", "xml", "js", "mjs", "cjs", "wasm", "pdf.js",
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MIN_ALT_LENGTH = 3;
export const DEFAULT_FOLDER = "uploads";
export const MAX_PATH_DEPTH = 6;

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export function isAllowedUploadType(value: string): value is AllowedUploadType {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(value);
}

export function extensionFor(mimeType: AllowedUploadType): string {
  return EXTENSIONS[mimeType];
}

function slug(raw: string, max: number): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function sanitizeSegment(raw: string): string {
  return slug(raw, 32);
}

export function sanitizeFolder(raw: string | undefined): string {
  const parts = (raw ?? "")
    .split("/")
    .map(sanitizeSegment)
    .filter((p) => p !== "")
    .slice(0, MAX_PATH_DEPTH);
  return parts.length === 0 ? DEFAULT_FOLDER : parts.join("/");
}

export function isSlugStablePath(path: string): boolean {
  return path !== "" && sanitizeFolder(path) === path;
}

export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = slug(base.replace(/\.[^.]*$/, ""), 64);
  return cleaned === "" ? "file" : cleaned;
}

export function buildStorageKey(
  folder: string | undefined,
  filename: string,
  mimeType: AllowedUploadType,
  random: string,
): string {
  return `${sanitizeFolder(folder)}/${Date.now()}-${random}-${sanitizeFilename(filename)}.${extensionFor(mimeType)}`;
}

export const STORAGE_KEY_RE =
  /^(?:[a-z0-9][a-z0-9-]{0,31}\/){1,6}\d{13}-[a-f0-9]{6,32}-[a-z0-9][a-z0-9-]{0,63}\.(?:jpg|png|webp|avif|gif|md|pdf|txt|json|csv)$/;

export function isStorageKey(value: string): boolean {
  return value.length <= 512 && STORAGE_KEY_RE.test(value);
}

const BUCKET_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isBucketKey(value: string): boolean {
  if (value === "" || value.length > 512 || value.endsWith("/")) return false;
  const parts = value.split("/");
  return parts.length <= MAX_PATH_DEPTH + 1 && parts.every((p) => BUCKET_SEGMENT_RE.test(p));
}

export function isBucketPrefix(value: string): boolean {
  if (value === "") return true;
  if (value.length > 512 || !value.endsWith("/")) return false;
  const parts = value.slice(0, -1).split("/");
  return parts.length <= MAX_PATH_DEPTH && parts.every((p) => BUCKET_SEGMENT_RE.test(p));
}

export function folderOfKey(key: string): string {
  const at = key.lastIndexOf("/");
  return at === -1 ? DEFAULT_FOLDER : key.slice(0, at);
}

export function parentPrefixOf(key: string): string {
  const at = key.lastIndexOf("/");
  return at === -1 ? "" : key.slice(0, at + 1);
}

export function leafNameOf(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const at = trimmed.lastIndexOf("/");
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

export function joinPrefix(prefix: string, name: string): string {
  return `${prefix}${name}/`;
}

export function markerKeyFor(prefix: string): string {
  return prefix;
}

export function childSegmentAfter(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const at = rest.indexOf("/");
  return at === -1 ? null : rest.slice(0, at);
}

export interface Crumb {
  name: string;
  prefix: string;
}

export function crumbsOf(prefix: string): Crumb[] {
  if (prefix === "") return [];
  const parts = prefix.split("/").filter((p) => p !== "");
  const trail: Crumb[] = [];
  let walked = "";
  for (const part of parts) {
    walked += `${part}/`;
    trail.push({ name: part, prefix: walked });
  }
  return trail;
}

const MINT_STAMP_RE = /^\d{13}-[a-f0-9]{6,32}-/;

export function displayNameOf(key: string): string {
  return leafNameOf(key).replace(MINT_STAMP_RE, "");
}

export type EntryKind = "image" | "doc" | "other";

export function extensionOfKey(key: string): string {
  const name = leafNameOf(key);
  const at = name.lastIndexOf(".");
  return at === -1 ? "" : name.slice(at + 1).toLowerCase();
}

export function kindOfKey(key: string): EntryKind {
  const ext = extensionOfKey(key);
  if (["jpg", "jpeg", "png", "webp", "avif", "gif"].includes(ext)) return "image";
  if (["md", "pdf", "txt", "json", "csv"].includes(ext)) return "doc";
  return "other";
}

export function isScriptableExtension(ext: string): boolean {
  return SCRIPTABLE_EXTENSIONS.has(ext.toLowerCase());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const PLACEHOLDER_ALT = new Set([
  "a", "an", "the", "alt", "alt text", "image", "images", "img", "photo", "photos",
  "picture", "pic", "screenshot", "screen shot", "screengrab", "logo", "icon",
  "banner", "graphic", "thumbnail", "thumb", "untitled", "asset", "file", "upload",
  "n/a", "na", "none", "-", "--", "...",
]);

export type AltIssue = "empty" | "placeholder" | "short";

export function altTextIssue(altText: string): AltIssue | null {
  const trimmed = altText.trim();
  if (trimmed === "") return "empty";

  const normalized = trimmed.toLowerCase().replace(/[.!?]+$/, "");
  if (PLACEHOLDER_ALT.has(normalized)) return "placeholder";
  if (/\.(?:jpe?g|png|webp|avif|gif)$/i.test(trimmed)) return "placeholder";

  if (trimmed.length < 12) return "short";
  return null;
}

export const ALT_ISSUE_LABEL: Record<AltIssue, string> = {
  empty: "no alt text",
  placeholder: "says nothing",
  short: "very short",
};

export interface MediaAssetDto {
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
  createdAt: string;
}

export interface BucketEntryDto {
  key: string;
  name: string;
  bytes: number;
  lastModified: string | null;
  kind: EntryKind;
  url: string;
  assetId: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  usedIn: string[];
  adoptable: boolean;
}

export interface BucketFolderDto {
  prefix: string;
  name: string;
}
