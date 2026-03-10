import { prisma } from "db";

export interface SiteConfig {
  name: string;
  tagline: string;
  intro: string;
  avatarUrl: string;
  resumeUrl: string;
  navbarLogo: string;
  contactEmail: string;
  availabilityStatus: string;
  availabilityDetail: string;
  copyrightName: string;
}

export async function getSiteConfig(): Promise<SiteConfig> {
  const rows = await prisma.siteConfig.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    name: map.get("name") ?? "",
    tagline: map.get("tagline") ?? "",
    intro: map.get("intro") ?? "",
    avatarUrl: map.get("avatarUrl") ?? "",
    resumeUrl: map.get("resumeUrl") ?? "",
    navbarLogo: map.get("navbarLogo") ?? "",
    contactEmail: map.get("contactEmail") ?? "",
    availabilityStatus: map.get("availabilityStatus") ?? "",
    availabilityDetail: map.get("availabilityDetail") ?? "",
    copyrightName: map.get("copyrightName") ?? "",
  };
}

export async function getHeroData() {
  const [titles, skills, socialLinks] = await Promise.all([
    prisma.heroTitle.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.heroSkillBadge.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
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
    prisma.aboutParagraph.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.education.findMany({ orderBy: { sortOrder: "asc" } }),
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
    orderBy: { sortOrder: "asc" },
  });
  return skills.map((s) => ({ name: s.name, iconKey: s.iconKey }));
}

export async function getExperiences() {
  const experiences = await prisma.experience.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      bullets: { orderBy: { sortOrder: "asc" } },
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
    bullets: exp.bullets.map((b) => b.content),
    technologies: exp.skills.map((s) => s.name),
  }));
}

export async function getProjects() {
  const projects = await prisma.project.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      bullets: { orderBy: { sortOrder: "asc" } },
      skills: { select: { name: true, iconKey: true } },
    },
  });
  return projects.map((p) => ({
    title: p.title,
    summary: p.summary,
    github: p.github,
    live: p.live,
    images: p.images,
    bullets: p.bullets.map((b) => b.content),
    technologies: p.skills.map((s) => ({ name: s.name, iconKey: s.iconKey })),
  }));
}

export async function getBlogs() {
  const blogs = await prisma.blog.findMany({
    where: { show: true },
    orderBy: { sortOrder: "asc" },
    select: {
      slug: true,
      title: true,
      description: true,
      image: true,
      imageOrientation: true,
      color: true,
    },
  });
  return blogs.map((b) => ({
    slug: b.slug,
    title: b.title,
    description: b.description,
    image: b.image,
    imageOrientation: b.imageOrientation as string,
    color: b.color,
  }));
}

export async function getBlogBySlug(slug: string) {
  const blog = await prisma.blog.findUnique({ where: { slug } });
  if (!blog || !blog.show) return null;
  return {
    slug: blog.slug,
    title: blog.title,
    description: blog.description,
    content: blog.content,
    image: blog.image,
    imageOrientation: blog.imageOrientation as string,
    color: blog.color,
  };
}

export async function getQuotes() {
  const quotes = await prisma.quote.findMany();
  return quotes.map((q) => ({ quote: q.quote, author: q.author }));
}

export async function getContactData() {
  const [purposes, socialLinks] = await Promise.all([
    prisma.contactPurpose.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.socialLink.findMany({ orderBy: { sortOrder: "asc" } }),
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
