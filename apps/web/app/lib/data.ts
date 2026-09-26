import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "db";
import { contentWhere } from "db/visibility";
import { tags } from "@repo/shared/tags";
import { cdnUrl } from "./site";

const CACHE_LIFETIME_SECONDS = 86400;

function reviveBlogDates<T extends { publishedAt: Date | null; updatedAt: Date }>(
  row: T,
): Omit<T, "publishedAt" | "updatedAt"> & { publishedAt: Date | null; updatedAt: Date } {
  return {
    ...row,
    publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export type HeroVersion = "v1" | "v2";

export type ProjectsVersion = "v1" | "v2";

export type CatNapStyle =
  | "tooltip" | "ring" | "halo" | "pixel" | "moon" | "ticks" | "random" | "off";

export type BackgroundVersion = "v1" | "v2";

export interface SiteBackground {
  version: BackgroundVersion;
  strength: number;
  veil: number;
  cell: number;
  levels: number;
  minor: number;
  major: number;
  channel: boolean;
  interactive: boolean;
}

export interface SiteConfig {
  name: string;
  heroVersion: HeroVersion;
  projectsVersion: ProjectsVersion;
  tagline: string;
  intro: string;
  avatarUrl: string;
  heroPhotos: string[];
  resumeUrl: string;
  navbarLogo: string;
  contactEmail: string;
  availabilityStatus: string;
  availabilityDetail: string;
  heroDotColor: string;
  heroDotPulse: boolean;
  catNapStyle: CatNapStyle;
  catNapSeconds: number;
  copyrightName: string;
  background: SiteBackground;
}

async function readSiteConfig(): Promise<SiteConfig> {
  const [settings, content] = await Promise.all([
    prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.heroContent.findMany(),
  ]);
  const live = content.find((c) => c.live) ?? content.find((c) => c.version === "v2") ?? null;
  const heroVersion: HeroVersion = live?.version ?? "v2";
  const intro = live?.intro ?? "";
  const tagline = live?.tagline ?? "";
  const background: SiteBackground = {
    version: settings.backgroundVersion,
    strength: settings.terrainStrength / 100,
    veil: settings.terrainVeil / 100,
    cell: settings.terrainCell,
    levels: settings.terrainLevels,
    minor: settings.terrainMinor / 100,
    major: settings.terrainMajor / 100,
    channel: settings.terrainChannel,
    interactive: settings.terrainInteractive,
  };
  return {
    name: settings.name,
    heroVersion,
    projectsVersion: settings.projectsVersion,
    tagline,
    intro,
    avatarUrl: cdnUrl(settings.avatarUrl),
    heroPhotos: settings.heroPhotos.map((p) => cdnUrl(p)),
    resumeUrl: settings.resumeUrl,
    navbarLogo: settings.navbarLogo,
    contactEmail: settings.contactEmail,
    availabilityStatus: settings.availabilityStatus,
    availabilityDetail: settings.availabilityDetail,
    heroDotColor: settings.heroDotColor,
    heroDotPulse: settings.heroDotPulse,
    catNapStyle: settings.catNapStyle.toLowerCase() as CatNapStyle,
    catNapSeconds: settings.catNapSeconds,
    copyrightName: settings.copyrightName,
    background,
  };
}

const cachedSiteConfig = unstable_cache(readSiteConfig, ["site-config"], {
  tags: [tags.siteConfig()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

export const getSiteConfig = cache(cachedSiteConfig);

export async function getHeroData(version: HeroVersion) {
  const [titles, skills, socialLinks] = await Promise.all([
    prisma.heroTitle.findMany({
      where: { version },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.heroSkillBadge.findMany({
      where: { version },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { label: true, skill: { select: { name: true, iconKey: true } } },
    }),
    prisma.socialLink.findMany({
      where: { OR: [{ version }, { version: null }] },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    titles: titles.map((t) => t.title),
    skills: skills.map((s) => ({ name: s.label ?? s.skill.name, iconKey: s.skill.iconKey })),
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
    where: { showInGrid: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return skills.map((s) => ({ name: s.name, iconKey: s.iconKey }));
}

export async function getExperiences() {
  const experiences = await prisma.experience.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      skills: { select: { skill: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  return experiences.map((exp) => ({
    company: exp.company,
    position: exp.position,
    location: exp.location,
    startedOn: exp.startedOn,
    endedOn: exp.endedOn,
    website: exp.website,
    logoUrl: cdnUrl(exp.logoUrl),
    visibleBullets: exp.visibleBullets,
    bullets: exp.bullets.map((b) => b.content),
    technologies: exp.skills.map((s) => s.skill.name),
  }));
}

export interface BuildHealth {
  status: "up" | "down" | "unknown";
  ms: number | null;
}

const PROBE_TIMEOUT_MS = 5000;

async function probeLive(url: string | null): Promise<BuildHealth> {
  if (!url) return { status: "unknown", ms: null };
  const attempt = async (method: "HEAD" | "GET") => {
    const started = performance.now();
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { res, ms: Math.round(performance.now() - started) };
  };
  try {
    let { res, ms } = await attempt("HEAD");
    if (res.status === 405 || res.status === 501) ({ res, ms } = await attempt("GET"));
    return { status: res.ok ? "up" : "down", ms };
  } catch {
    return { status: "down", ms: null };
  }
}

async function readProjects(isPreview: boolean) {
  const projects = await prisma.project.findMany({
    where: contentWhere(isPreview),
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      skills: {
        select: { skill: { select: { name: true, iconKey: true } } },
        orderBy: { sortOrder: "asc" },
      },
      gallery: {
        select: { externalUrl: true, asset: { select: { url: true } } },
        orderBy: { sortOrder: "asc" },
      },
      health: { select: { status: true, latencyMs: true } },
    },
  });
  const health = await Promise.all(
    projects.map((p): BuildHealth | Promise<BuildHealth> =>
      p.health?.status ? { status: p.health.status, ms: p.health.latencyMs } : probeLive(p.live),
    ),
  );
  return projects.map((p, i) => ({
    title: p.title,
    summary: p.summary,
    github: p.github,
    live: p.live,
    logoUrl: cdnUrl(p.logoUrl),
    images: p.gallery
      .map((img) => img.externalUrl ?? img.asset?.url ?? "")
      .filter(Boolean)
      .map((img) => cdnUrl(img)),
    bullets: p.bullets.map((b) => b.content),
    technologies: p.skills.map((s) => s.skill),
    health: health[i] ?? { status: "unknown" as const, ms: null },
  }));
}

function readPublicProjects() {
  return readProjects(false);
}

const cachedProjects = unstable_cache(readPublicProjects, ["projects"], {
  tags: [tags.projectIndex()],
  revalidate: CACHE_LIFETIME_SECONDS,
});

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
  const blogs = isPreview ? await readBlogs(true) : await cachedBlogs();
  return blogs.map(reviveBlogDates);
}

async function readBlogBySlug(slug: string, isPreview: boolean) {
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

function readPublicBlogBySlug(slug: string) {
  return readBlogBySlug(slug, false);
}

export async function getBlogBySlug(slug: string, isPreview = false) {
  if (isPreview) {
    const draft = await readBlogBySlug(slug, true);
    return draft === null ? null : reviveBlogDates(draft);
  }
  // built per call: unstable_cache fixes its tags at construction
  const cached = unstable_cache(readPublicBlogBySlug, ["blog-by-slug", slug], {
    tags: [tags.blog(slug), tags.blogIndex()],
    revalidate: CACHE_LIFETIME_SECONDS,
  });
  const blog = await cached(slug);
  return blog === null ? null : reviveBlogDates(blog);
}

export async function getQuotes() {
  const quotes = await prisma.quote.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return quotes.map((q) => ({ quote: q.quote, author: q.author }));
}

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
