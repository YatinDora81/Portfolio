"use server";

import { getSession } from "@/lib/session";

/**
 * Publish = ISR revalidation on the public site. The portfolio's homepage is
 * cached for 24h (`export const revalidate = 86400`), so CMS edits otherwise
 * wait out that window; this pokes /api/revalidate to flush it immediately.
 */
export async function publishSite(): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  if (session.role === "SUB_ADMIN") return { ok: false, error: "Sub-admins can't publish." };

  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return { ok: false, error: "REVALIDATE_SECRET isn't set on the admin app." };
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

  try {
    const res = await fetch(`${site}/api/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: `Revalidate returned ${res.status}.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
  }
}
