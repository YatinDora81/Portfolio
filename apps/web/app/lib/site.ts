// www is the canonical origin, the apex redirects to it
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://www.yatindora.in";

export const SITE_NAME = "Yatin Dora";

export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

// oneko/ is not on the CDN, its sprite resolves via a sibling path
export const CDN_URL =
  process.env.NEXT_PUBLIC_CDN_URL?.replace(/\/$/, "") ?? "https://cdn.yatindora.in";

export function cdnUrl<T extends string | null | undefined>(pathOrUrl: T): T {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${CDN_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}` as T;
}
