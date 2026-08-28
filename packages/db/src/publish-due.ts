import "server-only";

import { prisma } from "./index";

export type PublishedItem = {
  type: "Blog" | "Project";
  id: string;
  slug: string | null;
};

const RECHECK_MS = 60_000;

let nextDueAt: Date | null = null;
let lastCheckedAt = 0;

// requests are the tick, so this can double-run
export async function publishDueContent(now = new Date()): Promise<PublishedItem[]> {
  const published: PublishedItem[] = [];

  const [dueBlogs, dueProjects] = await Promise.all([
    prisma.blog.findMany({
      where: { status: "SCHEDULED", publishAt: { lte: now } },
      select: { id: true, slug: true, publishedAt: true },
      orderBy: { publishAt: "asc" },
    }),
    prisma.project.findMany({
      where: { status: "SCHEDULED", publishAt: { lte: now } },
      select: { id: true, publishedAt: true },
      orderBy: { publishAt: "asc" },
    }),
  ]);

  for (const blog of dueBlogs) {
    // a past date is the author's editorial date, leave it alone
    const datedInTheFuture = blog.publishedAt.getTime() > now.getTime();

    const res = await prisma.blog.updateMany({
      where: { id: blog.id, status: "SCHEDULED", publishAt: { lte: now } },
      data: {
        status: "PUBLISHED",
        ...(datedInTheFuture ? { publishedAt: now } : {}),
      },
    });

    if (res.count === 1) {
      published.push({ type: "Blog", id: blog.id, slug: blog.slug });
    }
  }

  for (const project of dueProjects) {
    const needsStamp = project.publishedAt === null || project.publishedAt.getTime() > now.getTime();

    const res = await prisma.project.updateMany({
      where: { id: project.id, status: "SCHEDULED", publishAt: { lte: now } },
      data: {
        status: "PUBLISHED",
        ...(needsStamp ? { publishedAt: now } : {}),
      },
    });

    if (res.count === 1) {
      published.push({ type: "Project", id: project.id, slug: null });
    }
  }

  return published;
}

export async function maybePublishDue(): Promise<PublishedItem[]> {
  const now = new Date();
  const nowMs = now.getTime();

  const checkedRecently = lastCheckedAt > 0 && nowMs - lastCheckedAt < RECHECK_MS;
  const nothingDue = nextDueAt === null || nextDueAt.getTime() > nowMs;
  if (checkedRecently && nothingDue) return [];

  const publishedItems = await publishDueContent(now);

  const [nextBlog, nextProject] = await Promise.all([
    prisma.blog.findFirst({
      where: { status: "SCHEDULED", publishAt: { not: null } },
      select: { publishAt: true },
      orderBy: { publishAt: "asc" },
    }),
    prisma.project.findFirst({
      where: { status: "SCHEDULED", publishAt: { not: null } },
      select: { publishAt: true },
      orderBy: { publishAt: "asc" },
    }),
  ]);

  const upcoming = [nextBlog?.publishAt, nextProject?.publishAt].filter(
    (d): d is Date => d != null,
  );
  nextDueAt =
    upcoming.length === 0 ? null : new Date(Math.min(...upcoming.map((d) => d.getTime())));
  lastCheckedAt = nowMs;

  return publishedItems;
}
