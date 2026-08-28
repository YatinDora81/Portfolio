"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

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
  "backgroundVersion",
  "terrainStrength",
  "terrainVeil",
  "terrainCell",
  "terrainLevels",
  "terrainMinor",
  "terrainMajor",
  "terrainChannel",
  "terrainInteractive",
  "copyrightName",
  "heroPhotos",
  // resumeUrl is absent: updateResumeUrl in ./links.ts owns that row
]);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const CAT_NAP_STYLES = new Set([
  "tooltip", "ring", "halo", "pixel", "moon", "ticks", "random", "off",
]);

const TERRAIN_RANGES: Record<string, { min: number; max: number; fallback: number }> = {
  terrainStrength: { min: 10, max: 100, fallback: 50 },
  terrainVeil: { min: 0, max: 90, fallback: 50 },
  terrainCell: { min: 8, max: 28, fallback: 12 },
  terrainLevels: { min: 4, max: 24, fallback: 14 },
  terrainMinor: { min: 2, max: 60, fallback: 20 },
  terrainMajor: { min: 5, max: 90, fallback: 48 },
};

function validate(key: string, value: string): string | null {
  if (!ALLOWED_KEYS.has(key)) return null;
  if (key === "heroDotColor") {
    const hex = value.trim();
    return hex === "" || HEX.test(hex) ? hex : "";
  }
  if (key === "heroDotPulse") return value === "off" ? "off" : "on";
  if (key === "catNapStyle") {
    const style = value.trim().toLowerCase();
    return CAT_NAP_STYLES.has(style) ? style : "ticks";
  }
  if (key === "projectsVersion") return value === "v1" ? "v1" : "v2";
  if (key === "backgroundVersion") return value === "v2" ? "v2" : "v1";
  if (key === "terrainChannel" || key === "terrainInteractive") {
    return value === "off" ? "off" : "on";
  }
  if (key === "catNapSeconds") {
    const secs = parseInt(value, 10);
    return String(Number.isFinite(secs) ? Math.min(300, Math.max(3, secs)) : 30);
  }
  const range = TERRAIN_RANGES[key];
  if (range) {
    const n = parseInt(value, 10);
    return String(
      Number.isFinite(n) ? Math.min(range.max, Math.max(range.min, n)) : range.fallback,
    );
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

  // update, never create, so an unknown key cannot be minted
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
  for (const path of ["/site-config", "/background", "/hero", "/cat", "/contact-purposes", "/projects"]) {
    revalidatePath(path);
  }
}
