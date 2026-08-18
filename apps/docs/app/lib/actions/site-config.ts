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
  "heroDotColor",
  "heroDotPulse",
  "catNapStyle",
  "catNapSeconds",
  "projectsVersion",
  "copyrightName",
  // Not in the form's registry, but real rows written by the links page.
  "heroPhotos",
  // resumeUrl is deliberately absent: `updateResumeUrl` in ./links.ts owns that
  // row and Hero's own form uses it. Allowing it here gave one row two writers.
]);

/** The only shape `heroDotColor` may take — see below. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Nap indicators the cat's script knows, plus "random" and "off". */
const CAT_NAP_STYLES = new Set([
  "tooltip", "ring", "halo", "pixel", "moon", "ticks", "random", "off",
]);

/** Returns the value to persist, or null to drop the entry entirely. */
function validate(key: string, value: string): string | null {
  if (!ALLOWED_KEYS.has(key)) return null;
  // These two are not free text: the hero paints the dot from `heroDotColor`
  // through an inline custom property, so a stored value is CSS the browser
  // runs. The picker only ever posts hex; anything else is stored as "" (the
  // monochrome default) rather than reaching a stylesheet. apps/web re-checks
  // the same pattern on read, so a row written around this action is inert too.
  if (key === "heroDotColor") {
    const hex = value.trim();
    return hex === "" || HEX.test(hex) ? hex : "";
  }
  if (key === "heroDotPulse") return value === "off" ? "off" : "on";
  // The cat reads these from data attributes and re-defaults anything it does
  // not recognise, so this is about what the admin can save, not about safety.
  if (key === "catNapStyle") {
    const style = value.trim().toLowerCase();
    return CAT_NAP_STYLES.has(style) ? style : "ticks";
  }
  // The whole Projects section is chosen by this one row, so an unknown string
  // parked here is a section that renders neither layout. apps/web coerces the
  // same way on read; both ends collapse to "v2" rather than trusting the row.
  if (key === "projectsVersion") return value === "v1" ? "v1" : "v2";
  if (key === "catNapSeconds") {
    const secs = parseInt(value, 10);
    return String(Number.isFinite(secs) ? Math.min(300, Math.max(3, secs)) : 30);
  }
  return value;
}

export async function updateSiteConfig(entries: { key: string; value: string }[]) {
  const session = await getSession();
  if (!session) return;

  const posted = entries.map(({ key, value }) => ({ key, value: String(value ?? "") }));

  const clean = posted
    .map(({ key, value }) => ({ key, value: validate(key, value) }))
    .filter((e): e is { key: string; value: string } => e.value !== null);

  // /site-config draws an editor for every row this file's registry does not
  // claim, so a key added by a migration can never become uneditable. Such a key
  // is outside ALLOWED_KEYS by definition, and dropping it here made that card
  // silently discard its own writes under a green "Saved". It is UPDATED, never
  // created, so the allow-list keeps the property it exists for: this action
  // still cannot mint a key that is not already a row.
  const unregistered = posted.filter((e) => !ALLOWED_KEYS.has(e.key));
  const live = unregistered.length
    ? new Set(
        (
          await prisma.siteConfig.findMany({
            where: { key: { in: unregistered.map((e) => e.key) } },
            select: { key: true },
          })
        ).map((r) => r.key)
      )
    : new Set<string>();
  const unclaimed = unregistered.filter((e) => live.has(e.key));

  if (clean.length === 0 && unclaimed.length === 0) return;

  await prisma.$transaction([
    ...clean.map(({ key, value }) =>
      prisma.siteConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
    ),
    ...unclaimed.map(({ key, value }) =>
      prisma.siteConfig.update({ where: { key }, data: { value } })
    ),
  ]);
  // Unconditional, and not just "/site-config". These keys are baked into the
  // preview panes on several other admin pages, and the layout-wide revalidate
  // that used to cover them only fired because the form happened to post
  // `heroVersion` on every save — which it no longer holds.
  for (const path of ["/site-config", "/hero", "/cat", "/contact-purposes", "/projects"]) {
    revalidatePath(path);
  }
}
