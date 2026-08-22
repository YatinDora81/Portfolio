import "server-only";

import { prisma } from "./index";

/**
 * Scheduled publishing, with no cron job anywhere in the project.
 *
 * There is no scheduler and there is not going to be one. A SCHEDULED row does
 * not become PUBLISHED because a clock fired; it becomes PUBLISHED because
 * somebody made a request that ran this code. Requests are the tick.
 *
 * That inverts the usual assumption in one important way: this runs on an
 * unknown number of instances, at unpredictable moments, possibly several at
 * once, and it may run twice for the same row within milliseconds. So the whole
 * design question is not "when does this fire" — it is "what happens when it
 * fires twice", and the answer has to be "nothing the second time", by
 * construction rather than by luck.
 *
 * TODO(phase-06): `/api/collect` becomes the primary trigger. It is hit by every
 * page view on the public site rather than only by an admin opening the
 * dashboard, which turns publishing latency from "whenever I next sign in" into
 * "the next visitor". The admin-load trigger stays as the fallback for a site
 * with no traffic — a portfolio has quiet days, and a post scheduled for one of
 * them still has to go out.
 */

export type PublishedItem = {
  type: "Blog" | "Project";
  id: string;
  /**
   * Blogs carry a slug and are tagged by it. Project has no slug column and no
   * unique string column at all, so it reports `null` here and every caller
   * tags it by id — `projectTags(id)`, never `projectTags(slug)`.
   */
  slug: string | null;
};

/** How long a "nothing is due yet" answer is trusted before the gate looks again. */
const RECHECK_MS = 60_000;

/**
 * The cheap gate's memory. Module scope means per-instance and per-cold-start:
 * a new lambda begins with `lastCheckedAt = 0` and re-reads, two instances keep
 * two independent copies, and a redeploy wipes both. All of that is fine,
 * because none of it is load-bearing — see `maybePublishDue`.
 */
let nextDueAt: Date | null = null;
let lastCheckedAt = 0;

/**
 * Publish everything whose time has come.
 *
 * 🔑 THE CORRECTNESS ARGUMENT, and it is the only one: the transition is a
 * single `updateMany` whose WHERE clause re-states the precondition
 * (`status: "SCHEDULED"`). Postgres serialises the row, so of two callers
 * racing the same post exactly one matches a row and updates it, and the other
 * matches zero. `count === 1` is therefore not "did the write succeed" but "was
 * I the one who made the transition" — which is precisely the question a caller
 * has to answer before it revalidates a tag or writes a log line.
 *
 * The `findMany` above is a *candidate list*, not a decision. It is tempting to
 * read that as the fetch-then-update anti-pattern; the difference is that
 * nothing here trusts the read. A row that stopped being SCHEDULED between the
 * select and the update simply fails the guard and is skipped. Move the status
 * check out of the WHERE clause and into an `if` in this file and the gap
 * between the two statements becomes the bug: two instances both see
 * SCHEDULED, both call `update`, and the post is published twice — two
 * revalidations, two log rows, and on Blog a `publishedAt` rewritten twice.
 */
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
    /**
     * ⚠️ The `publishedAt` decision, which is a real fork with a real bug down
     * each side.
     *
     * `Blog.publishedAt` predates this lifecycle. It is the editorial date the
     * article and its OpenGraph card print, and an author may have set it
     * deliberately — back-dated to when the piece was actually written, or to
     * keep a series in order. Overwriting it on every scheduled publish would
     * silently rewrite a date a human chose, and the author would have no way
     * to tell it had happened.
     *
     * But leaving it alone unconditionally is equally wrong, and worse because
     * it is invisible: `publicContentWhere` filters on `publishedAt: { lte: now }`,
     * so a post published today but dated next Tuesday is PUBLISHED and still
     * not on the site. The schedule fires, the status flips, the log says it
     * went out, and the post is nowhere.
     *
     * So: only when the stored date is in the future. A past or present date is
     * an editorial choice and is preserved untouched; a future one cannot be
     * kept without hiding the post, so it is pulled down to the moment it
     * actually went live. Every already-published post keeps its date, and
     * nothing published ends up invisible.
     */
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
    // Project's `publishedAt` arrived with the lifecycle and is nullable, so it
    // is not an editorial date the way Blog's is — but the same visibility trap
    // applies, since the public filter compares it against `now` for projects
    // too. Null must be stamped or the project never appears; a future date is
    // pulled down for the same reason as above; a past one is left alone in
    // case an admin set it on purpose.
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

/**
 * The cheap gate in front of `publishDueContent`.
 *
 * This is called from request paths that have nothing to do with publishing, so
 * the common case — nothing scheduled, or the next thing due in three days —
 * has to cost zero database round trips. It remembers the earliest scheduled
 * time it saw and skips entirely while that time is still in the future and the
 * memo is fresh.
 *
 * 🔑 None of this is correctness, and it matters that it is not. The memo lives
 * in module scope, which is per-instance: it resets on every cold start, two
 * concurrent instances hold two different copies, and one instance can be
 * confidently wrong about what another just scheduled. That is all acceptable,
 * because the worst outcome of a stale memo is a publish delayed by at most
 * RECHECK_MS, or a wasted query. The worst outcome of a wrong `updateMany`
 * guard is a double publish — and that guard is in the database, where nothing
 * about instance lifetime can reach it. If this whole memo were deleted the
 * behaviour would still be correct, only chattier.
 *
 * `RECHECK_MS` is the bound on how long a *newly* scheduled item can hide from
 * this instance: another instance (or the admin editor) can write a SCHEDULED
 * row at any moment, and this one has no way to hear about it, so it re-reads
 * at least that often regardless of what the memo claims.
 */
export async function maybePublishDue(): Promise<PublishedItem[]> {
  const now = new Date();
  const nowMs = now.getTime();

  const checkedRecently = lastCheckedAt > 0 && nowMs - lastCheckedAt < RECHECK_MS;
  const nothingDue = nextDueAt === null || nextDueAt.getTime() > nowMs;
  if (checkedRecently && nothingDue) return [];

  const publishedItems = await publishDueContent(now);

  // Both models, always. Reading only Blog here would leave a scheduled project
  // parked behind a blog's due date — or behind `null`, which the gate reads as
  // "nothing is ever due" and would sit on until the next cold start.
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
