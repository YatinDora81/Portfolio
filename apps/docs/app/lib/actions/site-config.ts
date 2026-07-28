"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so this runs for anyone who can reach the origin whether or not they ever
 * loaded the admin UI. Everything below the session check exists because of
 * that: an allow-list, so an arbitrary key cannot be minted.
 *
 * The hero's copy and the version it serves are NOT here any more — they are
 * columns on HeroContent, written through `applyStagedChanges`, so the one key
 * on this page that could reshape the public hero no longer passes through it.
 */
const ALLOWED_KEYS = new Set([
  "name",
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
  return ALLOWED_KEYS.has(key) ? value : null;
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
  // Unconditional, and not just "/site-config". These keys are baked into the
  // preview panes on several other admin pages, and the layout-wide revalidate
  // that used to cover them only fired because the form happened to post
  // `heroVersion` on every save — which it no longer holds.
  for (const path of ["/site-config", "/hero", "/social-links", "/links", "/contact-purposes"]) {
    revalidatePath(path);
  }
}
