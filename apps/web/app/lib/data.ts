import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { contentWhere } from "db/visibility";
import { tags } from "@repo/shared/tags";
import { cdnUrl } from "./site";

const CACHE_LIFETIME_SECONDS = 86400;

// `unstable_cache` JSON round-trips its value, so a cached `Date` comes back an ISO string while the type still says `Date`.
function reviveBlogDates<T extends { publishedAt: Date; updatedAt: Date }>(
  row: T,
): Omit<T, "publishedAt" | "updatedAt"> & { publishedAt: Date; updatedAt: Date } {
  return { ...row, publishedAt: new Date(row.publishedAt), updatedAt: new Date(row.updatedAt) };
}

export type HeroVersion = "v1" | "v2";

/** Which Projects layout is live: v1 the work ledger, v2 the build log. */
export type ProjectsVersion = "v1" | "v2";

/** Nap indicator the oneko cat shows when it sleeps. "off" means it never does. */
export type CatNapStyle =
  | "tooltip" | "ring" | "halo" | "pixel" | "moon" | "ticks" | "random" | "off";

const CAT_NAP_STYLES: CatNapStyle[] = [
  "tooltip", "ring", "halo", "pixel", "moon", "ticks", "random", "off",
];

/** Which layer draws behind the page: v1 the line field, v2 the contour terrain. */
export type BackgroundVersion = "v1" | "v2";

/**
 * The background layer, already coerced for the engine: the percent-stored rows
 * arrive here as 0..1 floats, and every number is inside the range the terrain
 * was tuned against.
 */
export interface SiteBackground {
  version: BackgroundVersion;
  /** Master line-opacity multiplier, 0..1. */
  strength: number;
  /** The fixed veil over the canvas, 0..1 of --background. */
  veil: number;
  /** Marching-squares grid cell, in px. */
  cell: number;
  /** How many contour levels the field is sliced into. */
  levels: number;
  /** Minor contour alpha, 0..1. */
  minor: number;
  /** Major contour alpha — every fourth line — 0..1. */
  major: number;
  /** Whether the reading channel is erased out of the field so body copy stays legible. */
  channel: boolean;
  /** Pointer flow, press rings and click ripples. */
  interactive: boolean;
}

export interface SiteConfig {
  name: string;
  heroVersion: HeroVersion;
  projectsVersion: ProjectsVersion;
  tagline: string;
  intro: string;
  avatarUrl: string;
  /** Hero peek-deck photos. Empty means "just the avatar" — Hero handles the fallback. */
  heroPhotos: string[];
  resumeUrl: string;
  navbarLogo: string;
  contactEmail: string;
  availabilityStatus: string;
  availabilityDetail: string;
  /** Hero status dot. "" means "follow --foreground", the monochrome default. */
  heroDotColor: string;
  /** Whether the hero status dot keeps its ping ripple. */
  heroDotPulse: boolean;
  /** Which indicator the napping cat shows, or "off" to stop it napping at all. */
  catNapStyle: CatNapStyle;
  /** How long a nap lasts, in seconds. */
  catNapSeconds: number;
  copyrightName: string;
  /** What renders under every page, and how the terrain is tuned when it is the one rendering. */
  background: SiteBackground;
}

/**
 * The dot's colour is painted through an inline custom property, so a stored
 * value reaches the browser as CSS. Only hex literals are let through — the
 * admin writes them with a colour picker, and anything else (a `url()`, a
 * second declaration) falls back to the default rather than being trusted.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The admin clamps these before it writes them, and this end clamps them again.
 * A SiteConfig row is a plain string in a table anyone with database access can
 * edit by hand, and the terrain reads its numbers straight into a per-frame
 * loop — a `terrainCell` of 1 is a marching-squares grid a pixel wide, which is
 * a locked tab rather than an ugly background. The engine clamps a third time
 * for the same reason; none of the three trusts the ones before it.
 */
function clampedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function readSiteConfig(): Promise<SiteConfig> {
  const [rows, content] = await Promise.all([
    prisma.siteConfig.findMany(),
    prisma.heroContent.findMany(),
  ]);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  // The hero the admin marked live. No row live is not an error state worth
  // throwing over — the site still has to render, so it falls back to v2, the
  // same coercion every other read of this used to make.
  const live = content.find((c) => c.live) ?? content.find((c) => c.version === "v2") ?? null;
  const heroVersion: HeroVersion = live?.version === "v1" ? "v1" : "v2";
  // No `||` chain any more: the migration resolved "v2 borrows v1's copy while
  // its own row is blank" once, into the rows themselves. Blank now means blank.
  const intro = live?.intro ?? "";
  const tagline = live?.tagline ?? "";
  // Normalised the way the admin writes it, so a row set by hand — "Off", or a
  // pasted trailing newline — still means what it says. Falling back silently
  // would leave the cat napping after someone had switched napping off.
  const rawNapStyle = (map.get("catNapStyle") ?? "ticks").trim().toLowerCase() as CatNapStyle;
  const catNapStyle: CatNapStyle = CAT_NAP_STYLES.includes(rawNapStyle) ? rawNapStyle : "ticks";
  const rawNapSeconds = parseInt(map.get("catNapSeconds") ?? "30", 10);
  const catNapSeconds = Number.isFinite(rawNapSeconds)
    ? Math.min(300, Math.max(3, rawNapSeconds))
    : 30;
  const background: SiteBackground = {
    // v1 unless the row says v2 outright, so an untouched database draws the
    // line field the site has always drawn.
    version: map.get("backgroundVersion") === "v2" ? "v2" : "v1",
    // Stored as whole percents to keep every row a plain integer string; the
    // divide happens once, here, and the engine only ever sees 0..1.
    strength: clampedInt(map.get("terrainStrength"), 50, 10, 100) / 100,
    veil: clampedInt(map.get("terrainVeil"), 50, 0, 90) / 100,
    cell: clampedInt(map.get("terrainCell"), 12, 8, 28),
    levels: clampedInt(map.get("terrainLevels"), 14, 4, 24),
    minor: clampedInt(map.get("terrainMinor"), 20, 2, 60) / 100,
    major: clampedInt(map.get("terrainMajor"), 48, 5, 90) / 100,
    channel: (map.get("terrainChannel") ?? "on") !== "off",
    interactive: (map.get("terrainInteractive") ?? "on") !== "off",
  };
  return {
    name: map.get("name") ?? "",
    heroVersion,
    // Same shape as the hero: a missing or unrecognised row is not worth
    // throwing over, so an untouched database renders the build log.
    projectsVersion: map.get("projectsVersion") === "v1" ? "v1" : "v2",
    tagline,
    intro,
    avatarUrl: cdnUrl(map.get("avatarUrl") ?? ""),
    // Stored as one comma-separated string so it stays a plain SiteConfig row.
    heroPhotos: (map.get("heroPhotos") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => cdnUrl(p)),
    resumeUrl: map.get("resumeUrl") ?? "",
    navbarLogo: map.get("navbarLogo") ?? "",
    contactEmail: map.get("contactEmail") ?? "",
    availabilityStatus: map.get("availabilityStatus") ?? "",
    availabilityDetail: map.get("availabilityDetail") ?? "",
    heroDotColor: HEX.test((map.get("heroDotColor") ?? "").trim())
      ? map.get("heroDotColor")!.trim()
      : "",
    // Absent row = the pulse the hero has always had, so an untouched database
    // renders exactly as before.
    heroDotPulse: (map.get("heroDotPulse") ?? "on") !== "off",
    catNapStyle,
    catNapSeconds,
    copyrightName: map.get("copyrightName") ?? "",
    background,
  };
}

const cachedSiteConfig = unstable_cache(readSiteConfig, ["site-config"], {
  tags: [tags.siteConfig()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

export const getSiteConfig = cache(cachedSiteConfig);

/** sortOrder is only meaningful within a version, so every query here is scoped. */
export async function getHeroData(version: HeroVersion) {
  const [titles, skills, socialLinks] = await Promise.all([
    prisma.heroTitle.findMany({
      where: { version },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.heroSkillBadge.findMany({
      where: { version },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.socialLink.findMany({
      where: { OR: [{ version }, { version: null }] },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    titles: titles.map((t) => t.title),
    skills: skills.map((s) => ({ name: s.name, iconKey: s.iconKey })),
    socialLinks: socialLinks.map((l) => ({
      name: l.name,
      href: l.href,
      iconKey: l.iconKey,
      detail: l.detail,
    })),
  };
}

export async function getAboutData() {
  const [paragraphs, education] = await Promise.all([
    prisma.aboutParagraph.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.education.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);
  return {
    paragraphs: paragraphs.map((p) => p.content),
    education: education.map((e) => ({
      institution: e.institution,
      location: e.location,
      degree: e.degree,
      scoreType: e.scoreType as string | null,
      score: e.score,
      scoreTotal: e.scoreTotal,
      startYear: e.startYear,
      endYear: e.endYear,
    })),
  };
}

export async function getSkills() {
  const skills = await prisma.skill.findMany({
    where: { show: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return skills.map((s) => ({ name: s.name, iconKey: s.iconKey }));
}

export async function getExperiences() {
  const experiences = await prisma.experience.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      skills: { select: { name: true } },
    },
  });
  return experiences.map((exp) => ({
    company: exp.company,
    position: exp.position,
    location: exp.location,
    startDate: exp.startDate,
    endDate: exp.endDate,
    isCurrent: exp.isCurrent,
    website: exp.website,
    logoUrl: cdnUrl(exp.logoUrl),
    visibleBullets: exp.visibleBullets,
    bullets: exp.bullets.map((b) => b.content),
    technologies: exp.skills.map((s) => s.name),
  }));
}

async function readProjects(isPreview: boolean) {
  const projects = await prisma.project.findMany({
    where: contentWhere(isPreview),
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      skills: { select: { name: true, iconKey: true } },
    },
  });
  return projects.map((p) => ({
    title: p.title,
    summary: p.summary,
    github: p.github,
    live: p.live,
    logoUrl: cdnUrl(p.logoUrl),
    images: p.images.map((img) => cdnUrl(img)),
    bullets: p.bullets.map((b) => b.content),
    technologies: p.skills.map((s) => ({ name: s.name, iconKey: s.iconKey })),
  }));
}

// `false` is hard-coded rather than passed in: no preview result can ever populate a public cache entry.
function readPublicProjects() {
  return readProjects(false);
}

const cachedProjects = unstable_cache(readPublicProjects, ["projects"], {
  tags: [tags.projectIndex()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

// No revival needed: `readProjects` returns no `Date` field. Add one and it needs `reviveBlogDates`-style handling.
export async function getProjects(isPreview = false) {
  return isPreview ? readProjects(true) : cachedProjects();
}

async function readBlogs(isPreview: boolean) {
  const blogs = await prisma.blog.findMany({
    where: contentWhere(isPreview),
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      slug: true,
      title: true,
      description: true,
      image: true,
      imageOrientation: true,
      color: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  return blogs.map((b) => ({
    slug: b.slug,
    title: b.title,
    description: b.description,
    image: cdnUrl(b.image),
    imageOrientation: b.imageOrientation as string,
    color: b.color,
    publishedAt: b.publishedAt,
    updatedAt: b.updatedAt,
  }));
}

function readPublicBlogs() {
  return readBlogs(false);
}

const cachedBlogs = unstable_cache(readPublicBlogs, ["blogs"], {
  tags: [tags.blogIndex()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

export async function getBlogs(isPreview = false) {
  // Revived on both arms so the cached and uncached paths return the same type.
  const blogs = isPreview ? await readBlogs(true) : await cachedBlogs();
  return blogs.map(reviveBlogDates);
}

async function readBlogBySlug(slug: string, isPreview: boolean) {
  // `findFirst`, not `findUnique`: the visibility clauses are not part of the unique key, and `slug` is still indexed.
  const blog = await prisma.blog.findFirst({
    where: { slug, ...contentWhere(isPreview) },
    select: {
      slug: true,
      title: true,
      description: true,
      content: true,
      image: true,
      imageOrientation: true,
      color: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  if (!blog) return null;
  return {
    slug: blog.slug,
    title: blog.title,
    description: blog.description,
    content: blog.content,
    image: cdnUrl(blog.image),
    imageOrientation: blog.imageOrientation as string,
    color: blog.color,
    publishedAt: blog.publishedAt,
    updatedAt: blog.updatedAt,
  };
}

/** Module-level so its source — half the cache key — is byte-identical on every call. */
function readPublicBlogBySlug(slug: string) {
  return readBlogBySlug(slug, false);
}

export async function getBlogBySlug(slug: string, isPreview = false) {
  // Preview never reaches the cache below, so a draft body cannot land in a public entry.
  if (isPreview) {
    const draft = await readBlogBySlug(slug, true);
    return draft === null ? null : reviveBlogDates(draft);
  }
  // Built per call, not hoisted: `unstable_cache` fixes its tags at construction, so a hoisted one could not carry `blog:<slug>`.
  const cached = unstable_cache(readPublicBlogBySlug, ["blog-by-slug", slug], {
    tags: [tags.blog(slug), tags.blogIndex()],
    revalidate: CACHE_LIFETIME_SECONDS,
  });
  const blog = await cached(slug);
  return blog === null ? null : reviveBlogDates(blog);
}

export async function getQuotes() {
  // Stable ordering so the day-of-year "thought of the day" pick is deterministic
  // across queries and deployments (Postgres has no implicit row order otherwise).
  const quotes = await prisma.quote.findMany({ orderBy: { id: "asc" } });
  return quotes.map((q) => ({ quote: q.quote, author: q.author }));
}

/** Deliberately unscoped: flipping the hero must not edit the contact list, and
    keeping this whole is what holds the JSON-LD `sameAs` union stable. */
export async function getContactData() {
  const [purposes, socialLinks] = await Promise.all([
    prisma.contactPurpose.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);
  return {
    purposes: purposes.map((p) => ({ label: p.label, emoji: p.emoji })),
    socialLinks: socialLinks.map((l) => ({
      name: l.name,
      href: l.href,
      iconKey: l.iconKey,
      detail: l.detail,
    })),
  };
}
