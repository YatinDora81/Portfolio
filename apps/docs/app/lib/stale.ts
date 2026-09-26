import "server-only";

import { prisma } from "db";
import { publicContentWhere } from "db/visibility";
import { blogTags, projectTags, tags } from "@repo/shared/tags";

export type StaleItem = {
  type: "Blog" | "Project";
  id: string;
  slug: string | null;
  title: string;
  tags: string[];
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
  const live = publicContentWhere();
  const [blogs, projects, states, siteFlushAt] = await Promise.all([
    prisma.blog.findMany({
      where: live,
      select: { id: true, slug: true, title: true, updatedAt: true },
    }),
    prisma.project.findMany({
      where: live,
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.tagState.findMany(),
    readLastSiteFlushAt(),
  ]);

  const lastSuccessByTag = new Map(states.map((s) => [s.tag, s.lastSuccessAt]));

  const stale: StaleItem[] = [];
  const consider = (ownTag: string, item: Omit<StaleItem, "lastRevalidatedAt">) => {
    const lastRevalidatedAt = latest(lastSuccessByTag.get(ownTag) ?? null, siteFlushAt);
    if (lastRevalidatedAt !== null && lastRevalidatedAt >= item.updatedAt) return;
    stale.push({ ...item, lastRevalidatedAt });
  };

  for (const blog of blogs) {
    consider(tags.blog(blog.slug), {
      type: "Blog",
      id: blog.id,
      slug: blog.slug,
      title: blog.title,
      tags: blogTags(blog.slug),
      updatedAt: blog.updatedAt,
    });
  }

  for (const project of projects) {
    consider(tags.project(project.id), {
      type: "Project",
      id: project.id,
      slug: null,
      title: project.title,
      tags: projectTags(project.id),
      updatedAt: project.updatedAt,
    });
  }

  stale.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return stale;
}
