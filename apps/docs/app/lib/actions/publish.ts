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
 * The POST itself now belongs to `@/lib/revalidation`, which times it and writes
 * a RevalidationLog row. That log and the audit trail answer different
 * questions — "what did the cache do" versus "who changed what" — so this action
 * still calls `recordPublish` on every path.
 *
 * Open to every signed-in admin, sub-admins included.
 */
export async function publishSite(opts?: { eventId?: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  // `@repo/config/env` parses REVALIDATE_SECRET as required at module load, so
  // this can no longer fire — a deployment missing it fails at boot instead.
  // Kept anyway: it is the branch that writes the audit record, and losing it
  // would put a Save & Publish back to showing "publish pending" forever if the
  // variable is ever demoted to optional.
  if (!env.REVALIDATE_SECRET) {
    // Recorded, unlike the missing-session branch above: the session is valid,
    // the publish was genuinely attempted, and it definitely failed.
    const miss = { ok: false, error: "REVALIDATE_SECRET isn't set on the admin app." };
    await recordPublish(session, opts?.eventId, miss);
    return miss;
  }

  let outcome: { ok: boolean; error?: string };
  try {
    // No paths and no tags, exactly as the hand-rolled fetch sent: /api/revalidate
    // reads an empty request as the legacy whole-site `revalidatePath("/", "layout")`.
    // This phase is about observing revalidation, not changing it — narrowing what
    // a publish flushes is a separate change with its own staleness to re-test.
    const res = await revalidate({
      // A Save & Publish arrives with the audit event id of the save it belongs
      // to; a bare topbar Publish has nothing behind it but the click.
      trigger: opts?.eventId ? "CONTENT_SAVE" : "MANUAL",
      actorId: session.userId,
    });
    outcome = res.ok
      ? { ok: true }
      : {
          ok: false,
          // A transport failure has no status. "We never reached the site" is the
          // outcome someone reading the history most needs to see, so it must not
          // render as "Revalidate returned undefined."
          error: res.error ?? (res.httpStatus ? `Revalidate returned ${res.httpStatus}.` : "Could not reach the site."),
        };
  } catch (e) {
    // `revalidate` documents itself as never throwing. Belt and braces regardless:
    // if that contract ever slips, an uncaught throw here skips `recordPublish`
    // and strands the save at "publish pending" — the bug this file already fixed
    // once — while the user sees a generic action error.
    outcome = { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
  }

  await recordPublish(session, opts?.eventId, outcome);
  return outcome;
}
