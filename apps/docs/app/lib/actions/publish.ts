"use server";

import { env } from "@repo/config/env";
import { getSession } from "@/lib/session";
import { recordPublish } from "@/lib/audit-writer";
import { revalidate } from "@/lib/revalidation";

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

  // Unreachable now that `@repo/config/env` parses REVALIDATE_SECRET as required, but this branch is what writes the audit record.
  if (!env.REVALIDATE_SECRET) {
    // Recorded, unlike the missing-session branch above: the session is valid,
    // the publish was genuinely attempted, and it definitely failed.
    const miss = { ok: false, error: "REVALIDATE_SECRET isn't set on the admin app." };
    await recordPublish(session, opts?.eventId, miss);
    return miss;
  }

  let outcome: { ok: boolean; error?: string };
  try {
    // No paths and no tags: /api/revalidate reads an empty request as the whole-site `revalidatePath("/", "layout")`.
    const res = await revalidate({
      trigger: opts?.eventId ? "CONTENT_SAVE" : "MANUAL",
      actorId: session.userId,
    });
    outcome = res.ok
      ? { ok: true }
      : {
          ok: false,
          // A transport failure has no `httpStatus`, so this must not render as "Revalidate returned undefined."
          error: res.error ?? (res.httpStatus ? `Revalidate returned ${res.httpStatus}.` : "Could not reach the site."),
        };
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
  }

  await recordPublish(session, opts?.eventId, outcome);
  return outcome;
}
