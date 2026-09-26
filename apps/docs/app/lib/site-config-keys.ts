import type { SiteSettingsModel } from "db";

export type ConfigColumn = Exclude<keyof SiteSettingsModel, "id" | "createdAt" | "updatedAt">;

export type ConfigOwner =
  | "background" | "hero" | "cat" | "contact" | "projects" | "chrome";

export type ConfigControl =
  | "text" | "mono" | "long" | "color" | "toggle" | "number" | "napStyle" | "photoList"
  | "versionTiles";

export interface ConfigRange {
  min: number;
  max: number;
  fallback: number;
}

export interface ConfigKeyDef {
  owner: ConfigOwner;
  label: string;
  description: string;
  control: ConfigControl;
  range?: ConfigRange;
  bespoke?: true;
}

export const KEYS: Record<ConfigColumn, ConfigKeyDef> = {
  backgroundVersion: {
    owner: "background", control: "versionTiles", label: "Layer",
    description: "Which field sits under every page — v1's fifty drawn lines, or v2's contour map. Site-wide, not per section.",
  },
  terrainStrength: {
    owner: "background", control: "number", label: "Strength",
    range: { min: 10, max: 100, fallback: 50 },
    description: "Master multiplier on every contour's opacity, in percent (10–100). Scales the minor and major lines together — the first dial to reach for.",
  },
  terrainVeil: {
    owner: "background", control: "number", label: "Veil",
    range: { min: 0, max: 90, fallback: 50 },
    description: "How much page ground is laid back over the canvas, in percent (0–90). Higher sinks the map further under the text.",
  },
  terrainCell: {
    owner: "background", control: "number", label: "Grid cell",
    range: { min: 8, max: 28, fallback: 12 },
    description: "The marching-squares cell, in pixels (8–28). Smaller draws a smoother map and costs more per frame; 12 is what it was tuned at.",
  },
  terrainLevels: {
    owner: "background", control: "number", label: "Levels",
    range: { min: 4, max: 24, fallback: 14 },
    description: "How many heights the field is sliced into (4–24). More levels is a denser map, not a taller one.",
  },
  terrainMinor: {
    owner: "background", control: "number", label: "Minor lines",
    range: { min: 2, max: 60, fallback: 20 },
    description: "Opacity of an ordinary contour, in percent (2–60), before Strength scales it.",
  },
  terrainMajor: {
    owner: "background", control: "number", label: "Major lines",
    range: { min: 5, max: 90, fallback: 48 },
    description: "Opacity of every fourth contour, in percent (5–90). These index lines are what give the map its grain.",
  },
  terrainChannel: {
    owner: "background", control: "toggle", label: "Reading channel",
    description: "Erases the map out of the 720px column the site's text sits in. Off puts contours behind body copy.",
  },
  terrainInteractive: {
    owner: "background", control: "toggle", label: "Interactive",
    description: "Flow under a moving pointer, rings under a resting one, a ripple on click. Off draws the map once and leaves it still.",
  },

  name: {
    owner: "hero", control: "text", label: "Name",
    description: "The first name in the hero heading, and the name the browser tab and structured data carry.",
  },
  avatarUrl: {
    owner: "hero", control: "mono", label: "Avatar",
    description: "Path or URL to the portrait. Used alone when the photo deck below is empty.",
  },
  heroPhotos: {
    owner: "hero", control: "photoList", label: "Photo deck",
    description: "The fanned stack behind the avatar — first path is the top card. Blank rows are dropped on save.",
  },
  heroDotColor: {
    owner: "hero", control: "color", label: "Dot colour",
    description: "The dot beside the hero's status line. Blank follows the site's text colour.",
  },
  heroDotPulse: {
    owner: "hero", control: "toggle", label: "Pulse",
    description: "The ripple around the dot.",
  },

  resumeUrl: {
    owner: "hero", control: "mono", label: "Résumé", bespoke: true,
    description: "Written by updateResumeUrl, not updateSiteConfig — it keeps its own form on Hero.",
  },

  contactEmail: {
    owner: "contact", control: "mono", label: "Contact email",
    description: "The address the section is built around. Empty removes the address, its carrier wave and the mailto.",
  },
  availabilityStatus: {
    owner: "contact", control: "text", label: "Status",
    description: "The caption under the oscilloscope, and the pill in the hero. Verbatim CMS copy.",
  },
  availabilityDetail: {
    owner: "contact", control: "long", label: "Detail",
    description: "The line beside the transmit button — what happens after someone writes to you.",
  },

  projectsVersion: {
    owner: "projects", control: "versionTiles", label: "Layout",
    description: "Which of the two layouts section 05 renders — v1's ranked ledger, or v2's build log. Every project row is shared between them.",
  },

  catNapStyle: {
    owner: "cat", control: "napStyle", label: "Nap style",
    description: "What the cat shows while it sleeps, or Never sleeps to switch napping off.",
  },
  catNapSeconds: {
    owner: "cat", control: "number", label: "Nap length",
    range: { min: 3, max: 300, fallback: 30 },
    description: "Seconds the cat sleeps before it wakes and starts chasing again (3–300).",
  },

  navbarLogo: {
    owner: "chrome", control: "text", label: "Navbar logo",
    description: "The wordmark at the top left of every page.",
  },
  copyrightName: {
    owner: "chrome", control: "text", label: "Copyright name",
    description: "The name in the footer's copyright line.",
  },
};

export function keysFor(owner: ConfigOwner): ConfigColumn[] {
  return (Object.keys(KEYS) as ConfigColumn[]).filter(
    (k) => KEYS[k].owner === owner && !KEYS[k].bespoke,
  );
}

export function configValues(settings: SiteSettingsModel): Record<ConfigColumn, string> {
  return {
    backgroundVersion: settings.backgroundVersion,
    terrainStrength: String(settings.terrainStrength),
    terrainVeil: String(settings.terrainVeil),
    terrainCell: String(settings.terrainCell),
    terrainLevels: String(settings.terrainLevels),
    terrainMinor: String(settings.terrainMinor),
    terrainMajor: String(settings.terrainMajor),
    terrainChannel: onOff(settings.terrainChannel),
    terrainInteractive: onOff(settings.terrainInteractive),
    name: settings.name,
    avatarUrl: settings.avatarUrl,
    heroPhotos: settings.heroPhotos.join(","),
    heroDotColor: settings.heroDotColor,
    heroDotPulse: onOff(settings.heroDotPulse),
    resumeUrl: settings.resumeUrl,
    contactEmail: settings.contactEmail,
    availabilityStatus: settings.availabilityStatus,
    availabilityDetail: settings.availabilityDetail,
    projectsVersion: settings.projectsVersion,
    catNapStyle: napLabel(settings.catNapStyle),
    catNapSeconds: String(settings.catNapSeconds),
    navbarLogo: settings.navbarLogo,
    copyrightName: settings.copyrightName,
  };
}

function onOff(on: boolean): string {
  return on ? "on" : "off";
}

export type ProjectsVersion = SiteSettingsModel["projectsVersion"];

export function toProjectsVersion(raw: string | null | undefined): ProjectsVersion {
  return raw === "v1" ? "v1" : "v2";
}

export const PROJECT_LAYOUTS: { value: ProjectsVersion; name: string; detail: string }[] = [
  {
    value: "v1",
    name: "the ledger",
    detail: "ranked index · hairline dividers · mono stack line · hovering one row dims the rest",
  },
  {
    value: "v2",
    name: "the build log",
    detail: "deployment records · typed domains · prod-framed shots · badge pills · end-of-log line",
  },
];

export type BackgroundVersion = SiteSettingsModel["backgroundVersion"];

export function toBackgroundVersion(raw: string | null | undefined): BackgroundVersion {
  return raw === "v2" ? "v2" : "v1";
}

export const BACKGROUND_LAYERS: { value: BackgroundVersion; name: string; detail: string }[] = [
  {
    value: "v1",
    name: "the lines",
    detail: "fifty curved strokes · one static SVG, re-inked by the theme · fourteen gradient beams sweeping on a CSS keyframe · beams off below 1024px",
  },
  {
    value: "v2",
    name: "the terrain",
    detail: "contour map of a height field · flows under a moving pointer, still while you read · rings on press, ripple on click · canvas that sleeps when nothing moves · not drawn at all below 1024px, where the reading channel would erase it whole",
  },
];

export const NUMBER_RANGE: Record<string, ConfigRange> = Object.fromEntries(
  Object.entries(KEYS).flatMap(([key, def]) => (def.range ? [[key, def.range] as const] : [])),
);

export function clampNumber(key: string, raw: string): number {
  const range = NUMBER_RANGE[key] ?? { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 };
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

export const DOT_PRESETS = [
  { value: "#22C55E", label: "Green" },
  { value: "#10B981", label: "Emerald" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#A855F7", label: "Violet" },
  { value: "#F43F5E", label: "Rose" },
];

export type CatNapStyle = SiteSettingsModel["catNapStyle"];

export type NapLabel = "tooltip" | "ring" | "halo" | "pixel" | "moon" | "ticks" | "random" | "off";

const NAP_LABEL: Record<CatNapStyle, NapLabel> = {
  TOOLTIP: "tooltip",
  RING: "ring",
  HALO: "halo",
  PIXEL: "pixel",
  MOON: "moon",
  TICKS: "ticks",
  RANDOM: "random",
  OFF: "off",
};

const NAP_STYLE: Record<NapLabel, CatNapStyle> = {
  tooltip: "TOOLTIP",
  ring: "RING",
  halo: "HALO",
  pixel: "PIXEL",
  moon: "MOON",
  ticks: "TICKS",
  random: "RANDOM",
  off: "OFF",
};

export function napLabel(style: CatNapStyle): NapLabel {
  return NAP_LABEL[style];
}

export function toNapStyle(raw: string): CatNapStyle {
  const label = raw.trim().toLowerCase();
  return isNapLabel(label) ? NAP_STYLE[label] : "TICKS";
}

function isNapLabel(raw: string): raw is NapLabel {
  return Object.hasOwn(NAP_STYLE, raw);
}

export const NAP_STYLES: { value: NapLabel; label: string }[] = [
  { value: "ticks", label: "Ticks — watch-face dial around the cat" },
  { value: "moon", label: "Moon — crescent crosses a starry arc overhead" },
  { value: "pixel", label: "Pixel — 8-bit speech bubble with a block bar" },
  { value: "halo", label: "Halo — breathing glow, no numbers" },
  { value: "ring", label: "Ring — thin progress ring, seconds on hover" },
  { value: "tooltip", label: "Tooltip — micro pill, seconds and a draining border" },
  { value: "random", label: "Random — a different one every nap" },
  { value: "off", label: "Never sleeps — still draggable, just never naps" },
];
