"use server";

import { getSession } from "@/lib/session";
import { recordPublish } from "@/lib/audit-writer";

/**
 * Publish = ISR revalidation on the public site, and the ONLY thing that pushes
 * saved changes live. Mutation actions no longer revalidate the portfolio, so a
 * save stays invisible to visitors until someone publishes. The homepage is
 * cached for 24h (`export const revalidate = 86400`), so without this poke to
 * /api/revalidate an edit would wait out that window.
 *
 * Open to every signed-in admin, sub-admins included.
 */
export async function publishSite(opts?: { eventId?: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    // Recorded, unlike the missing-session branch above: the session is valid,
    // the publish was genuinely attempted, and it definitely failed. Leaving it
    // out would show a Save & Publish stuck at "publish pending" forever.
    const miss = { ok: false, error: "REVALIDATE_SECRET isn't set on the admin app." };
    await recordPublish(session, opts?.eventId, miss);
    return miss;
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

  try {
    const res = await fetch(`${site}/api/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
      cache: "no-store",
    });
    const result = res.ok
      ? { ok: true }
      : { ok: false, error: `Revalidate returned ${res.status}.` };
    await recordPublish(session, opts?.eventId, result);
    return result;
  } catch (e) {
    const result = { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
    // Transport failures are recorded too — "we never reached the site" is the
    // outcome someone reading the history most needs to see.
    await recordPublish(session, opts?.eventId, result);
    return result;
  }
}
