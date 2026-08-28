import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export const CDN_URL =
  process.env.NEXT_PUBLIC_CDN_URL?.replace(/\/$/, "") ?? "https://cdn.yatindora.in";

export function cdnUrl<T extends string | null | undefined>(pathOrUrl: T): T {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${CDN_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}` as T;
}
