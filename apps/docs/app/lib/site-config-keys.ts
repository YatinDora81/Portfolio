/**
 * The one place that says which section owns which SiteConfig row.
 *
 * SiteConfig used to be one page of eleven fields. It is now split across one
 * page per site section, and this registry is what makes that split safe:
 * every page renders `keysFor(owner)` and nothing else, so a key can never be
 * edited from two places, and /site-config renders `owner: "chrome"` PLUS any
 * row in the database that is absent from this file — so a key added by a
 * migration can never be orphaned either.
 *
 * `resumeUrl` is deliberately NOT here. It is written by `updateResumeUrl`
 * (app/lib/actions/links.ts), not by `updateSiteConfig`; adding it "for
 * consistency" would give one row two writers racing each other. It keeps its
 * own form, on /hero.
 *
 * Paired with the allow-list in app/lib/actions/site-config.ts — a key here that
 * is missing there is silently dropped on save, so the two move together.
 */

export type ConfigOwner =
  | "background" | "hero" | "cat" | "contact" | "projects" | "chrome";

/**
 * Which control draws the key. `napStyle` and `photoList` have no default
 * renderer inside ConfigCard: `napStyle`'s picker lives on the Cat page and
 * `photoList`'s editor is a list, so both come in through ConfigCard's
 * `controls` override. Anything not overridden falls back to a text field, so
 * a key is always editable even before its bespoke control exists.
 *
 * The three of them plus `versionTiles` also declare a WIDTH: ConfigCard pairs
 * short controls two to a row, and a card-wide control caught in that pairing
 * renders at half the card. Adding a control here that needs the full measure
 * means listing it in `fields()` alongside them.
 */
export type ConfigControl =
  | "text" | "mono" | "long" | "color" | "toggle" | "number" | "napStyle" | "photoList"
  | "versionTiles";

export interface ConfigKeyDef {
  owner: ConfigOwner;
  label: string;
  description: string;
  control: ConfigControl;
  /** Edited by a bespoke form on its owning page rather than by a ConfigCard —
      so the owner is real, but no generic control should be drawn for it. */
  bespoke?: true;
  /** A row nothing reads any more. Claimed only so /site-config's safety net
      stops offering an editor for a value that reaches no visitor. */
  legacy?: true;
}

export const KEYS: Record<string, ConfigKeyDef> = {
  // ── Background ──
  // First, because it is drawn first: this layer is under every section below
  // it. The eight terrain rows only reach a visitor while `backgroundVersion`
  // is v2 — v1 is an SVG that reads none of them.
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

  // ── Hero ──
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

  // ── Rows the site no longer reads ──
  // apps/web/app/lib/data.ts:60-64 takes the live hero's version, intro and
  // tagline from the HeroContent row, not from SiteConfig. These three are
  // leftovers; they are claimed so /site-config stops drawing an editor whose
  // saves reach nothing, and left in the database because deleting rows is not
  // this file's job.
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

  // ── Contact ──
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

  // ── Projects ──
  projectsVersion: {
    owner: "projects", control: "versionTiles", label: "Layout",
    description: "Which of the two layouts section 05 renders — v1's ranked ledger, or v2's build log. Every project row is shared between them.",
  },

  // ── Cat ──
  catNapStyle: {
    owner: "cat", control: "napStyle", label: "Nap style",
    description: "What the cat shows while it sleeps, or Never sleeps to switch napping off.",
  },
  catNapSeconds: {
    owner: "cat", control: "number", label: "Nap length",
    description: "Seconds the cat sleeps before it wakes and starts chasing again (3–300).",
  },

  // ── Site chrome ──
  navbarLogo: {
    owner: "chrome", control: "text", label: "Navbar logo",
    description: "The wordmark at the top left of every page.",
  },
  copyrightName: {
    owner: "chrome", control: "text", label: "Copyright name",
    description: "The name in the footer's copyright line.",
  },
};

/** Every key this owner draws, in registry order. */
export function keysFor(owner: ConfigOwner): string[] {
  return Object.keys(KEYS).filter(
    (k) => KEYS[k]!.owner === owner && !KEYS[k]!.bespoke && !KEYS[k]!.legacy,
  );
}

/** True for a database row no section has claimed — /site-config's safety net. */
export function isUnclaimed(key: string): boolean {
  return !(key in KEYS);
}

/**
 * What the site serves when the row is missing, so a form reads what visitors
 * actually get rather than an empty box. Blank is a real value everywhere else.
 */
export const DEFAULTS: Record<string, string> = {
  catNapStyle: "ticks",
  catNapSeconds: "30",
  projectsVersion: "v2",
  // "v1" so an untouched database renders the background the site has always
  // rendered; the terrain only appears once someone asks for it here.
  backgroundVersion: "v1",
  // Percentages are stored as plain integers and divided by 100 on read, so
  // every row on this page stays an integer string a human can read.
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

/**
 * The one coercion for `projectsVersion`, mirrored by the save action and by
 * apps/web on read: anything that is not exactly "v1" is the v2 build log. A
 * missing row, a legacy value and a hostile POST therefore all land on the same
 * layout instead of on an empty section.
 */
export function toProjectsVersion(raw: string | null | undefined): ProjectsVersion {
  return raw === "v1" ? "v1" : "v2";
}

/** The two layouts, described well enough to choose between without opening the site. */
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

/**
 * The one coercion for `backgroundVersion`, mirrored by the save action and by
 * apps/web on read. It leans the other way from `toProjectsVersion`: anything
 * that is not exactly "v2" is the line field, because that is what the site
 * rendered before this key existed. A missing row, a truncated value and a
 * hostile POST therefore all leave the background exactly as it was.
 */
export function toBackgroundVersion(raw: string | null | undefined): BackgroundVersion {
  return raw === "v2" ? "v2" : "v1";
}

/** The two layers, described well enough to choose between without opening the site. */
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

/** The range `updateSiteConfig` clamps to anyway — mirrored so the field agrees. */
export const NUMBER_RANGE: Record<string, { min: number; max: number }> = {
  catNapSeconds: { min: 3, max: 300 },
  // The terrain's six dials. `terrainCell`'s floor is the one that is about
  // cost rather than taste: the grid is two-dimensional, so halving the cell
  // quadruples the squares the marching pass walks every frame.
  terrainStrength: { min: 10, max: 100 },
  terrainVeil: { min: 0, max: 90 },
  terrainCell: { min: 8, max: 28 },
  terrainLevels: { min: 4, max: 24 },
  terrainMinor: { min: 2, max: 60 },
  terrainMajor: { min: 5, max: 90 },
};

/** The value the row holds after the action has had an unparseable number. */
const NUMBER_FALLBACK: Record<string, number> = {
  catNapSeconds: 30,
  // Without these, `clampNumber` would fall back to each range's floor, and a
  // fumbled keystroke in the Strength field would silently pick the faintest
  // map on offer instead of the default one.
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

/**
 * Offered beside the hero dot picker. Status greens first — what a live
 * availability dot usually wants — then the accents the site already uses.
 */
export const DOT_PRESETS = [
  { value: "#22C55E", label: "Green" },
  { value: "#10B981", label: "Emerald" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#A855F7", label: "Violet" },
  { value: "#F43F5E", label: "Rose" },
];

/** The eight nap indicators the cat's script knows, plus random and off. */
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
