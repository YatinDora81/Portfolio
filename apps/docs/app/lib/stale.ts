import "server-only";

import { prisma } from "db";
import { tags } from "@repo/shared/tags";

// blog only: `Project` has no `updatedAt` to compare against

export type StaleItem = {
  type: "Blog";
  id: string;
  slug: string;
  title: string;
  updatedAt: Date;
  lastRevalidatedAt: Date | null;
};

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

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
    const lastRevalidatedAt = latest(tagSuccessAt, siteFlushAt);
    // never flushed at all counts as stale
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
