import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { contentWhere } from "db/visibility";
import { tags } from "@repo/shared/tags";
import { cdnUrl } from "./site";

/**
 * The backstop, not the mechanism. A publish in the admin flushes the matching
 * tag and the next request re-reads immediately; this only bounds how long a
 * flush that never arrived — a failed POST, a deploy that rotated the secret —
 * can keep the site wrong. 24h matches the page-level `revalidate` the routes
 * already carry, so nothing here shortens a route's ISR window.
 */
const CACHE_LIFETIME_SECONDS = 86400;

/**
 * `unstable_cache` persists its result as `JSON.stringify(...)` and hands back
 * `JSON.parse(...)` on a hit, so a `Date` leaves as a Date on the miss that
 * populated the entry and comes back an ISO *string* on every hit after it —
 * while the declared type still says `Date`. Rehydrating at the boundary is
 * what stops that type from lying: `app/sitemap.ts` passes `updatedAt` straight
 * to `lastModified`, which Next calls `.toISOString()` on. `new Date(x)` is
 * correct for both arms, so this holds whether the value was cached or fresh.
 */
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
}

/**
 * The dot's colour is painted through an inline custom property, so a stored
 * value reaches the browser as CSS. Only hex literals are let through — the
 * admin writes them with a colour picker, and anything else (a `url()`, a
 * second declaration) falls back to the default rather than being trusted.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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
  };
}

const cachedSiteConfig = unstable_cache(readSiteConfig, ["site-config"], {
  tags: [tags.siteConfig()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

// Both wrappers, and neither is redundant. `unstable_cache` persists the two
// queries across requests and is what `revalidateTag("site-config")` can reach;
// React's `cache` dedupes *within* one render, which is still needed because the
// root layout reads this for the cat's nap settings and the home page reads it
// again for everything else. Drop the memo and one render of `/` pays for two
// lookups; drop the outer tag and a publish cannot flush this at all.
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

/**
 * Preview and the public never share a cache entry.
 *
 * `unstable_cache` builds its key from the callback source, the key parts and
 * the arguments, so threading `isPreview` through as an argument would file
 * draft rows and public rows in the same tagged namespace one key apart. Then
 * the safety of the whole site rests on two keys never colliding — and if they
 * ever did, a single preview would populate the entry every anonymous visitor
 * reads next, silently, for the next 24 hours. That is not a bug anything here
 * would catch; it is a bug someone reports.
 *
 * So preview gets no cache at all. The three cached callbacks below hard-code
 * `false` and take no visibility argument, which is why no preview value can
 * reach them: a draft read goes straight to Postgres, uncached and untagged.
 * It costs nothing worth counting — preview is one signed cookie, one person,
 * one page, and it already bypasses the route's ISR entry to get here.
 *
 * The corollary is that the public entries keep exactly the keys and tags they
 * had, so `revalidateTag` still reaches them and the route table is unchanged.
 */

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

/** The public arm, and the only thing the cache below ever calls. `false` is
    written here rather than passed in, so no caller can put a preview result
    into a public entry however it calls `getProjects`. */
function readPublicProjects() {
  return readProjects(false);
}

// Only `projects`, not the per-project tag: this reads every project, so the id
// of any one of them is not a handle on this entry.
const cachedProjects = unstable_cache(readPublicProjects, ["projects"], {
  tags: [tags.projectIndex()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

/**
 * No date rehydration here, and that is a property of the projection rather
 * than luck: `readProjects` returns no `Date` at all. `publishedAt` and
 * `updatedAt` are read by the filter and by the stale detector but never
 * returned, so nothing this hands back can be a Date that JSON turned into a
 * string. Return either one through here and it needs reviving first.
 */
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

/** See `readPublicProjects`: the public arm hard-codes its own visibility. */
function readPublicBlogs() {
  return readBlogs(false);
}

const cachedBlogs = unstable_cache(readPublicBlogs, ["blogs"], {
  tags: [tags.blogIndex()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

export async function getBlogs(isPreview = false) {
  // Revived on both arms, not just the cached one. The uncached preview read
  // hands back real Dates already and `new Date(aDate)` is a copy, so running
  // it either way costs a clone and buys the two arms an identical return type
  // — which is what stops a caller from working in preview and breaking live.
  const blogs = isPreview ? await readBlogs(true) : await cachedBlogs();
  return blogs.map(reviveBlogDates);
}

async function readBlogBySlug(slug: string, isPreview: boolean) {
  // The predicate is in the query now. This used to be `findUnique({ where:
  // { slug } })` with `if (!blog || !blog.show) return null` on the next line —
  // one JS statement standing between an unpublished draft and four public
  // surfaces: the article, its `generateMetadata`, its OpenGraph image, and the
  // unauthenticated JSON at `/api/blogs/[slug]`. Any refactor that dropped the
  // line, or any new caller that read the row before it, leaked all four.
  //
  // `findFirst` rather than `findUnique` because the visibility clauses are not
  // part of the unique key; `slug` is still `@unique`, so this matches at most
  // one row and still uses that index.
  //
  // The `select` is the second half: a draft's `content` is never read out of
  // Postgres at all, so it cannot sit in a cache entry, a log line or a heap
  // dump waiting for the guard above it to be removed.
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

/** See `readPublicProjects`. Module-level so its source — half the cache key —
    is byte-identical on every call for a given slug. */
function readPublicBlogBySlug(slug: string) {
  return readBlogBySlug(slug, false);
}

export async function getBlogBySlug(slug: string, isPreview = false) {
  // Preview never reaches the cache below, so a draft body is never written to
  // a tagged entry that a public request could later be served from.
  if (isPreview) {
    const draft = await readBlogBySlug(slug, true);
    return draft === null ? null : reviveBlogDates(draft);
  }
  // Built per call, not hoisted. `unstable_cache` fixes its tag list at
  // construction and only the *key* varies with the arguments, so a module-level
  // wrapper could carry `blogs` but never `blog:<slug>` — every post would share
  // one tag, and editing one post would flush all of them or none. Constructing
  // inside the wrapper is what makes the per-post tag possible. The cache key
  // stays stable across calls: it is derived from the callback source plus
  // `keyParts` plus the arguments, all of which are the same for a given slug.
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
