"use server";

import { env } from "@repo/config/env";
import { getSession } from "@/lib/session";
import { recordPublish } from "@/lib/audit-writer";
import { revalidate } from "@/lib/revalidation";

export async function publishSite(opts?: { eventId?: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  if (!env.REVALIDATE_SECRET) {
    const miss = { ok: false, error: "REVALIDATE_SECRET isn't set on the admin app." };
    await recordPublish(session, opts?.eventId, miss);
    return miss;
  }

  let outcome: { ok: boolean; error?: string };
  try {
    // an empty request revalidates the whole site
    const res = await revalidate({
      trigger: opts?.eventId ? "CONTENT_SAVE" : "MANUAL",
      actorId: session.userId,
    });
    outcome = res.ok
      ? { ok: true }
      : {
          ok: false,
          error: res.error ?? (res.httpStatus ? `Revalidate returned ${res.httpStatus}.` : "Could not reach the site."),
        };
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
  }

  await recordPublish(session, opts?.eventId, outcome);
  return outcome;
}
