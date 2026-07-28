"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so this runs for anyone who can reach the origin whether or not they ever
 * loaded the admin UI. Everything below the session check exists because of
 * that: an allow-list, so an arbitrary key cannot be minted, and a per-key
 * validator, because `heroVersion` decides what the whole public hero renders.
 */
const ALLOWED_KEYS = new Set([
  "name",
  "tagline",
  "intro",
  "taglineV2",
  "introV2",
  "heroVersion",
  "avatarUrl",
  "navbarLogo",
  "contactEmail",
  "availabilityStatus",
  "availabilityDetail",
  "copyrightName",
  // Not in the form's registry, but real rows written by the links page.
  "heroPhotos",
  "resumeUrl",
]);

/** Returns the value to persist, or null to drop the entry entirely. */
function validate(key: string, value: string): string | null {
  if (!ALLOWED_KEYS.has(key)) return null;
  if (key === "heroVersion") return value === "v1" || value === "v2" ? value : null;
  return value;
}

export async function updateSiteConfig(entries: { key: string; value: string }[]) {
  const session = await getSession();
  if (!session) return;

  const clean = entries
    .map(({ key, value }) => ({ key, value: validate(key, String(value ?? "")) }))
    .filter((e): e is { key: string; value: string } => e.value !== null);
  if (clean.length === 0) return;

  await prisma.$transaction(
    clean.map(({ key, value }) =>
      prisma.siteConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
    )
  );
  revalidatePath("/site-config");
  // The hero version reshapes every page that previews it.
  if (clean.some((e) => e.key === "heroVersion")) revalidatePath("/", "layout");
}
