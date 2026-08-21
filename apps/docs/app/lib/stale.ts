import "server-only";

import { prisma } from "db";
import { tags } from "@repo/shared/tags";

/**
 * Content that has been edited since the last time its cache tag successfully
 * flushed — the saved-but-never-published set.
 *
 * Blog only, and that is a schema fact rather than a shortcut: the `Project`
 * model has no `updatedAt` column and no `slug` (see
 * packages/db/prisma/schema.prisma). With no edit timestamp there is nothing to
 * compare a project's tag state against, so including projects would mean
 * either inventing a timestamp or listing all six of them as stale forever.
 * Projects join this detector the migration that gives them an `updatedAt`.
 */

export type StaleItem = {
  type: "Blog";
  id: string;
  slug: string;
  title: string;
  updatedAt: Date;
  /**
   * The effective flush time: the later of this post's own tag state and the
   * most recent whole-site flush. Null only when neither has ever happened.
   */
  lastRevalidatedAt: Date | null;
};

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * When the site was last flushed whole, or null if it never has been.
 *
 * `publishSite()` — the flush this product actually uses, at eight call sites —
 * deliberately sends no paths and no tags, which /api/revalidate answers with
 * `revalidatePath("/", "layout")`: a real flush of the homepage, the sitemap
 * and every /blog/<slug>. But naming no tags means `revalidate()` has no tag to
 * stamp TagState for, so on tag state alone a successful site-wide publish
 * updates nothing and every post reads "never revalidated" forever. The empty
 * `paths`/`tags` arrays are what identify that shape in the log.
 */
async function readLastSiteFlushAt(): Promise<Date | null> {
  const row = await prisma.revalidationLog.findFirst({
    where: { status: "SUCCESS", paths: { isEmpty: true }, tags: { isEmpty: true } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function findStaleContent(): Promise<StaleItem[]> {
  const [blogs, states, siteFlushAt] = await Promise.all([
    prisma.blog.findMany({
      // Mirrors the public site's own filter: apps/web/app/lib/data.ts queries
      // `where: { show: true }` in `getBlogs`, and `getBlogBySlug` returns null
      // for a hidden post so its route 404s. A post no visitor can reach cannot
      // be serving a stale copy of anything.
      where: { show: true },
      select: { id: true, slug: true, title: true, updatedAt: true },
    }),
    prisma.tagState.findMany(),
    readLastSiteFlushAt(),
  ]);

  const lastSuccessByTag = new Map(states.map((s) => [s.tag, s.lastSuccessAt]));

  const stale: StaleItem[] = [];
  for (const blog of blogs) {
    const tagSuccessAt = lastSuccessByTag.get(tags.blog(blog.slug)) ?? null;
    // A layout flush is a floor under every blog tag: it re-rendered the very
    // routes those tags exist to invalidate, so nothing it covered can be older
    // than that flush, whatever TagState does or does not say.
    const lastRevalidatedAt = latest(tagSuccessAt, siteFlushAt);
    // Neither having happened counts as stale: nothing has ever flushed, so
    // whatever the public app is serving predates every edit this row has had.
    if (lastRevalidatedAt !== null && lastRevalidatedAt >= blog.updatedAt) continue;
    stale.push({
      type: "Blog",
      id: blog.id,
      slug: blog.slug,
      title: blog.title,
      updatedAt: blog.updatedAt,
      lastRevalidatedAt,
    });
  }

  stale.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return stale;
}
