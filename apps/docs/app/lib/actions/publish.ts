"use server";

import { getSession } from "@/lib/session";

/**
 * Publish = ISR revalidation on the public site, and the ONLY thing that pushes
 * saved changes live. Mutation actions no longer revalidate the portfolio, so a
 * save stays invisible to visitors until someone publishes. The homepage is
 * cached for 24h (`export const revalidate = 86400`), so without this poke to
 * /api/revalidate an edit would wait out that window.
 *
 * Open to every signed-in admin, sub-admins included.
 */
export async function publishSite(): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

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
