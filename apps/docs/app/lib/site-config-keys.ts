export type ConfigOwner =
  | "background" | "hero" | "cat" | "contact" | "projects" | "chrome";

export type ConfigControl =
  | "text" | "mono" | "long" | "color" | "toggle" | "number" | "napStyle" | "photoList"
  | "versionTiles";

export interface ConfigKeyDef {
  owner: ConfigOwner;
  label: string;
  description: string;
  control: ConfigControl;
  bespoke?: true;
  legacy?: true;
}

export const KEYS: Record<string, ConfigKeyDef> = {
  backgroundVersion: {
    owner: "background", control: "versionTiles", label: "Layer",
    description: "Which field sits under every page — v1's fifty drawn lines, or v2's contour map. Site-wide, not per section.",
  },
  terrainStrength: {
    owner: "background", control: "number", label: "Strength",
    description: "Master multiplier on every contour's opacity, in percent (10–100). Scales the minor and major lines together — the first dial to reach for.",
  },
  terrainVeil: {
    owner: "background", control: "number", label: "Veil",
    description: "How much page ground is laid back over the canvas, in percent (0–90). Higher sinks the map further under the text.",
  },
  terrainCell: {
    owner: "background", control: "number", label: "Grid cell",
    description: "The marching-squares cell, in pixels (8–28). Smaller draws a smoother map and costs more per frame; 12 is what it was tuned at.",
  },
  terrainLevels: {
    owner: "background", control: "number", label: "Levels",
    description: "How many heights the field is sliced into (4–24). More levels is a denser map, not a taller one.",
  },
  terrainMinor: {
    owner: "background", control: "number", label: "Minor lines",
    description: "Opacity of an ordinary contour, in percent (2–60), before Strength scales it.",
  },
  terrainMajor: {
    owner: "background", control: "number", label: "Major lines",
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
    description: "The fanned stack behind the avatar. Stored as one comma-separated row — first path is the top card.",
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

  heroVersion: {
    owner: "hero", control: "text", label: "Hero version", legacy: true,
    description: "Superseded by HeroContent.live.",
  },
  intro: {
    owner: "hero", control: "long", label: "Intro", legacy: true,
    description: "Superseded by HeroContent.intro — edited on Hero.",
  },
  tagline: {
    owner: "hero", control: "text", label: "Tagline", legacy: true,
    description: "Superseded by HeroContent.tagline — edited on Hero.",
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

export function keysFor(owner: ConfigOwner): string[] {
  return Object.keys(KEYS).filter(
    (k) => KEYS[k]!.owner === owner && !KEYS[k]!.bespoke && !KEYS[k]!.legacy,
  );
}

export function isUnclaimed(key: string): boolean {
  return !(key in KEYS);
}

export const DEFAULTS: Record<string, string> = {
  catNapStyle: "ticks",
  catNapSeconds: "30",
  projectsVersion: "v2",
  backgroundVersion: "v1",
  // percentages stored as integers, divided by 100 on read
  terrainStrength: "50",
  terrainVeil: "50",
  terrainCell: "12",
  terrainLevels: "14",
  terrainMinor: "20",
  terrainMajor: "48",
  terrainChannel: "on",
  terrainInteractive: "on",
};

export type ProjectsVersion = "v1" | "v2";

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

export type BackgroundVersion = "v1" | "v2";

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

export const NUMBER_RANGE: Record<string, { min: number; max: number }> = {
  catNapSeconds: { min: 3, max: 300 },
  terrainStrength: { min: 10, max: 100 },
  terrainVeil: { min: 0, max: 90 },
  terrainCell: { min: 8, max: 28 },
  terrainLevels: { min: 4, max: 24 },
  terrainMinor: { min: 2, max: 60 },
  terrainMajor: { min: 5, max: 90 },
};

const NUMBER_FALLBACK: Record<string, number> = {
  catNapSeconds: 30,
  terrainStrength: 50,
  terrainVeil: 50,
  terrainCell: 12,
  terrainLevels: 14,
  terrainMinor: 20,
  terrainMajor: 48,
};

export function clampNumber(key: string, raw: string): number {
  const range = NUMBER_RANGE[key] ?? { min: 0, max: Number.MAX_SAFE_INTEGER };
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return NUMBER_FALLBACK[key] ?? range.min;
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

export const NAP_STYLES: { value: string; label: string }[] = [
  { value: "ticks", label: "Ticks — watch-face dial around the cat" },
  { value: "moon", label: "Moon — crescent crosses a starry arc overhead" },
  { value: "pixel", label: "Pixel — 8-bit speech bubble with a block bar" },
  { value: "halo", label: "Halo — breathing glow, no numbers" },
  { value: "ring", label: "Ring — thin progress ring, seconds on hover" },
  { value: "tooltip", label: "Tooltip — micro pill, seconds and a draining border" },
  { value: "random", label: "Random — a different one every nap" },
  { value: "off", label: "Never sleeps — still draggable, just never naps" },
];
