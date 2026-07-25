// Canonical host for the public site. `www` is the canonical origin (the apex
// redirects to it), so using it directly avoids an extra redirect hop and keeps
// canonical/OG/sitemap URLs consistent. Overridable via env for previews.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://www.yatindora.in";

export const SITE_NAME = "Yatin Dora";

/** Resolve a possibly-relative asset path to an absolute URL on the canonical host. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

// R2 bucket fronted by a CDN. The bucket mirrors the old `public/` layout
// (`/logos/*`, `/mine/*`, `/projects/*`), so the relative paths already stored
// in the DB map onto it 1:1 — no data migration was needed to cut over.
// `oneko/` is deliberately NOT on the CDN: it's app chrome, and oneko.js
// resolves its sprite via a sibling path, so the pair stays same-origin.
export const CDN_URL =
  process.env.NEXT_PUBLIC_CDN_URL?.replace(/\/$/, "") ?? "https://cdn.yatindora.in";

/**
 * Resolve a DB-stored asset path to its CDN URL.
 *
 * Passes through absolute URLs untouched, so dashboard-entered `https://…`
 * values keep working alongside repo-relative `/logos/foo.png` ones.
 */
export function cdnUrl<T extends string | null | undefined>(pathOrUrl: T): T {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${CDN_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}` as T;
}
