/**
 * The one place that says which section owns which SiteConfig row.
 *
 * SiteConfig used to be one page of eleven fields. It is now split across four
 * pages, one per site section, and this registry is what makes that split safe:
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

export type ConfigOwner = "hero" | "cat" | "contact" | "projects" | "chrome";

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

/** The range `updateSiteConfig` clamps to anyway — mirrored so the field agrees. */
export const NUMBER_RANGE: Record<string, { min: number; max: number }> = {
  catNapSeconds: { min: 3, max: 300 },
};

/** The value the row holds after the action has had an unparseable number. */
const NUMBER_FALLBACK: Record<string, number> = { catNapSeconds: 30 };

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
