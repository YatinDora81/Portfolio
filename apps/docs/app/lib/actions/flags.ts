"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FLAG_DEFINITIONS } from "@repo/shared/flags";
import { tags } from "@repo/shared/tags";
import { getSession } from "@/lib/session";
import { revalidate } from "@/lib/revalidation";

const KNOWN_KEYS = new Set<string>(FLAG_DEFINITIONS.map((d) => d.key));

const FlagInput = z.object({
  key: z.string().min(1, "A flag key is required."),
  enabled: z.boolean(),
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

  // The registry check is the authorisation; the `count === 0` check below is the other half, since `updateMany` reports a missing row as a quiet success of zero rows.
  if (!KNOWN_KEYS.has(key)) {
    return { ok: false, revalidated: false, error: "Unknown flag." };
  }

  // `updateMany`, never `upsert`: a key from the client must not be able to create rows.
  const trimmed = note?.trim();
  const updated = await prisma.featureFlag.updateMany({
    where: { key },
    data: {
      enabled,
      updatedById: session.userId,
      // An omitted note leaves the column alone; an empty string clears it to null, so "no note" is one value rather than two.
      ...(note === undefined ? {} : { note: trimmed ? trimmed : null }),
    },
  });

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
