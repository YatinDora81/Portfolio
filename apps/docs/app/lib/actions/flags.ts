"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FLAG_DEFINITIONS } from "@repo/shared/flags";
import { tags } from "@repo/shared/tags";
import { getSession } from "@/lib/session";
import { revalidate } from "@/lib/revalidation";

/**
 * The kill switches, written from the control room.
 *
 * The session check opens the one export here for the same reason it opens
 * every export in ./revalidation.ts: a `"use server"` function compiles to a
 * public POST endpoint addressable by its action id, middleware does not run
 * for a server-action POST, and `(dashboard)/layout.tsx` gates pages rather
 * than actions. This call is the only thing between the internet and the
 * ability to switch the public site's sections off.
 */

/** The registry's keys as a lookup — see the two-check note in `setFlag`. */
const KNOWN_KEYS = new Set<string>(FLAG_DEFINITIONS.map((d) => d.key));

const FlagInput = z.object({
  key: z.string().min(1, "A flag key is required."),
  enabled: z.boolean(),
  // Long enough for a real sentence about an incident, short enough that this
  // cannot be used to park arbitrary payloads in the flags table.
  note: z.string().max(500, "Keep the note under 500 characters.").optional(),
});

export async function setFlag(input: {
  key: string;
  enabled: boolean;
  note?: string;
}): Promise<{
  ok: boolean;
  revalidated: boolean;
  revalidateError?: string;
  error?: string;
}> {
  const session = await getSession();
  if (!session) return { ok: false, revalidated: false, error: "Not signed in." };

  const parsed = FlagInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      revalidated: false,
      error: parsed.error.issues[0]?.message ?? "That is not a valid flag change.",
    };
  }

  const { key, enabled, note } = parsed.data;

  // Two checks, and both earn their place. The registry check is the real
  // authorisation: `key` arrives from a client component, so it arrives from
  // whoever is posting, and without this any string would reach the database.
  // The `count === 0` check below is the *other* half — a key can be perfectly
  // legitimate and still have no row (the seed has not run for a flag added
  // last week), and `updateMany` reports that as a quiet success of zero rows.
  // Dropping either one turns a change that changed nothing into a green tick.
  if (!KNOWN_KEYS.has(key)) {
    return { ok: false, revalidated: false, error: "Unknown flag." };
  }

  // `updateMany`, never `upsert` and never `create`. A key from the client that
  // can create rows means unknown keys pile up in the table forever, each one
  // looking like a real switch nothing reads.
  const trimmed = note?.trim();
  const updated = await prisma.featureFlag.updateMany({
    where: { key },
    data: {
      enabled,
      updatedById: session.userId,
      // An omitted note leaves the column alone: flipping a switch must not
      // silently erase the sentence explaining why it was flipped last time.
      // An empty string is a deliberate clear, and stores null rather than ""
      // so "no note" is one value in the database instead of two.
      ...(note === undefined ? {} : { note: trimmed ? trimmed : null }),
    },
  });

  // Not "Unknown flag." — the key passed the registry check three statements
  // ago, so the only thing missing is the row, and telling an admin their key
  // is wrong right after the page told them it is right sends them hunting for
  // a typo instead of running the seed.
  if (updated.count === 0) {
    return {
      ok: false,
      revalidated: false,
      error: "This flag has no row in the database yet — run `bun run flags:seed` in packages/db, then try again.",
    };
  }

  const result = await revalidate({
    tags: [tags.flags()],
    trigger: "FLAG_CHANGE",
    entityType: "FeatureFlag",
    entityId: key,
    actorId: session.userId,
  });

  revalidatePath("/flags");

  // The save and the flush are reported as two facts, never folded into one
  // `ok`. The row is already committed at this point, so answering `ok: false`
  // because the flush failed would tell the admin to retry a write that
  // succeeded — and answering `ok: true` alone would tell them a section is
  // hidden while the public site happily keeps serving it from cache. The
  // second is the failure this whole phase exists to make visible: a toggle
  // that looks live and is not.
  return {
    ok: true,
    revalidated: result.ok,
    revalidateError: result.ok
      ? undefined
      : (result.error ??
        (result.httpStatus != null
          ? `Failed with HTTP ${result.httpStatus} and no error body.`
          : "The flush failed, and returned no error text.")),
  };
}
