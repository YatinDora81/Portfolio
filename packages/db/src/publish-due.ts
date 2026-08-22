import "server-only";

import { prisma } from "./index";

// There is no scheduler: requests are the tick, so this may run twice for the
// same row at once and must do nothing the second time.
//
// TODO(phase-06): `/api/collect` becomes the primary trigger. It is hit by every
// page view on the public site rather than only by an admin opening the
// dashboard, which turns publishing latency from "whenever I next sign in" into
// "the next visitor". The admin-load trigger stays as the fallback for a site
// with no traffic — a portfolio has quiet days, and a post scheduled for one of
// them still has to go out.

export type PublishedItem = {
  type: "Blog" | "Project";
  id: string;
  /** Null for a Project — it has no slug column, so callers tag it by id. */
  slug: string | null;
};

/** How long a "nothing is due yet" answer is trusted before the gate looks again. */
const RECHECK_MS = 60_000;

let nextDueAt: Date | null = null;
let lastCheckedAt = 0;

// The `status: "SCHEDULED"` guard inside each `updateMany` is what makes this safe:
// `count === 1` means this caller made the transition, not merely that a write ran.
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
    // Only re-stamp a future date: a past one is the author's editorial date, but a
    // future one would keep the post out of `publishedAt: { lte: now }` after publishing.
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
    // Same trap, plus null: an unstamped project never passes the public filter.
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

// A per-instance memo to skip the query, not a correctness mechanism: a stale one
// costs at most RECHECK_MS of delay, since another instance can schedule a row at
// any moment without this one hearing about it.
export async function maybePublishDue(): Promise<PublishedItem[]> {
  const now = new Date();
  const nowMs = now.getTime();

  const checkedRecently = lastCheckedAt > 0 && nowMs - lastCheckedAt < RECHECK_MS;
  const nothingDue = nextDueAt === null || nextDueAt.getTime() > nowMs;
  if (checkedRecently && nothingDue) return [];

  const publishedItems = await publishDueContent(now);

  // Both models: a `null` here reads as "nothing is ever due" until the next cold start.
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
