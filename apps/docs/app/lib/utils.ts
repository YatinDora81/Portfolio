import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// Mirror of apps/web/app/lib/site.ts — the two apps deploy independently, so
// each resolves asset paths itself. Both read NEXT_PUBLIC_CDN_URL, which is
// what actually keeps them in sync.
export const CDN_URL =
  process.env.NEXT_PUBLIC_CDN_URL?.replace(/\/$/, "") ?? "https://cdn.yatindora.in";

/**
 * Resolve a DB-stored asset path (`/logos/foo.png`) to its CDN URL so the
 * dashboard previews show the same images the live site does. Absolute URLs
 * pass through untouched.
 */
export function cdnUrl<T extends string | null | undefined>(pathOrUrl: T): T {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${CDN_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}` as T;
}
