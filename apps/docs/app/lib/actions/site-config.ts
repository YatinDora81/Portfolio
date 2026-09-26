"use server";

import { prisma, type Prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  clampNumber, toBackgroundVersion, toNapStyle, toProjectsVersion,
} from "@/lib/site-config-keys";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hex(value: string): string {
  const raw = value.trim();
  return raw === "" || HEX.test(raw) ? raw : "";
}

function photos(value: string): string[] {
  return value.split(",").map((p) => p.trim()).filter((p) => p !== "");
}

function validate(key: string, value: string): Prisma.SiteSettingsUpdateInput | null {
  switch (key) {
    case "name": return { name: value };
    case "avatarUrl": return { avatarUrl: value };
    case "heroPhotos": return { heroPhotos: photos(value) };
    case "heroDotColor": return { heroDotColor: hex(value) };
    case "heroDotPulse": return { heroDotPulse: value !== "off" };
    case "navbarLogo": return { navbarLogo: value };
    case "copyrightName": return { copyrightName: value };
    case "contactEmail": return { contactEmail: value };
    case "availabilityStatus": return { availabilityStatus: value };
    case "availabilityDetail": return { availabilityDetail: value };
    case "projectsVersion": return { projectsVersion: toProjectsVersion(value) };
    case "backgroundVersion": return { backgroundVersion: toBackgroundVersion(value) };
    case "terrainStrength": return { terrainStrength: clampNumber(key, value) };
    case "terrainVeil": return { terrainVeil: clampNumber(key, value) };
    case "terrainCell": return { terrainCell: clampNumber(key, value) };
    case "terrainLevels": return { terrainLevels: clampNumber(key, value) };
    case "terrainMinor": return { terrainMinor: clampNumber(key, value) };
    case "terrainMajor": return { terrainMajor: clampNumber(key, value) };
    case "terrainChannel": return { terrainChannel: value !== "off" };
    case "terrainInteractive": return { terrainInteractive: value !== "off" };
    case "catNapStyle": return { catNapStyle: toNapStyle(value) };
    case "catNapSeconds": return { catNapSeconds: clampNumber(key, value) };
    default: return null;
  }
}

export async function updateSiteConfig(entries: { key: string; value: string }[]) {
  const session = await getSession();
  if (!session) return;

  const data: Prisma.SiteSettingsUpdateInput = {};
  for (const { key, value } of entries) {
    const column = validate(key, String(value ?? ""));
    if (column) Object.assign(data, column);
  }

  if (Object.keys(data).length === 0) return;

  await prisma.siteSettings.update({ where: { id: 1 }, data });
  for (const path of ["/site-config", "/background", "/hero", "/cat", "/contact-purposes", "/projects"]) {
    revalidatePath(path);
  }
}
