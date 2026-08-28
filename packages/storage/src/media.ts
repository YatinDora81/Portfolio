export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXTENSIONS: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MIN_ALT_LENGTH = 3;
export const DEFAULT_FOLDER = "uploads";

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export function extensionFor(mimeType: AllowedImageType): string {
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

export function sanitizeFolder(raw: string | undefined): string {
  const cleaned = slug(raw ?? "", 32);
  return cleaned === "" ? DEFAULT_FOLDER : cleaned;
}

export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = slug(base.replace(/\.[^.]*$/, ""), 64);
  return cleaned === "" ? "file" : cleaned;
}

export function buildStorageKey(
  folder: string | undefined,
  filename: string,
  mimeType: AllowedImageType,
  random: string,
): string {
  return `${sanitizeFolder(folder)}/${Date.now()}-${random}-${sanitizeFilename(filename)}.${extensionFor(mimeType)}`;
}

export const STORAGE_KEY_RE =
  /^[a-z0-9][a-z0-9-]{0,31}\/\d{13}-[a-f0-9]{6,32}-[a-z0-9][a-z0-9-]{0,63}\.(?:jpg|png|webp|avif|gif)$/;

export function isStorageKey(value: string): boolean {
  return STORAGE_KEY_RE.test(value);
}

export function folderOfKey(key: string): string {
  return key.split("/")[0] ?? DEFAULT_FOLDER;
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
