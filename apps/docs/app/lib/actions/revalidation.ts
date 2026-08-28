"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { ALL_KNOWN_TAGS, blogTags } from "@repo/shared/tags";
import { getSession } from "@/lib/session";
import { revalidate } from "@/lib/revalidation";
import { findStaleContent } from "@/lib/stale";

const ROW_TAG = /^(?:blog|project):[A-Za-z0-9._-]{1,200}$/;

const MAX_STALE_PER_RUN = 10;
const STALE_RUN_BUDGET_MS = 20_000;

export async function revalidateNow(input: {
  paths?: string[];
  tags?: string[];
}): Promise<{ ok: boolean; durationMs: number; httpStatus?: number; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, durationMs: 0, error: "Not signed in." };

  const knownTags = new Set(ALL_KNOWN_TAGS);
  const tags = (input.tags ?? []).filter((t) => knownTags.has(t) || ROW_TAG.test(t));
  const paths = (input.paths ?? []).filter((p) => p.startsWith("/"));

  if (tags.length === 0 && paths.length === 0) {
    return { ok: false, durationMs: 0, error: "Nothing valid to revalidate." };
  }

  const result = await revalidate({
    paths,
    tags,
    trigger: "MANUAL",
    actorId: session.userId,
  });

  revalidatePath("/revalidation");
  return result;
}

export async function revalidateWholeSite(): Promise<{
  ok: boolean;
  durationMs: number;
  httpStatus?: number;
  error?: string;
}> {
  const session = await getSession();
  if (!session) return { ok: false, durationMs: 0, error: "Not signed in." };

  const result = await revalidate({
    trigger: "MANUAL",
    actorId: session.userId,
  });

  revalidatePath("/revalidation");
  return result;
}

export async function revalidateBlog(
  id: string,
): Promise<{ ok: boolean; durationMs: number; httpStatus?: number; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, durationMs: 0, error: "Not signed in." };

  const blog = await prisma.blog.findUnique({ where: { id }, select: { slug: true } });
  if (!blog) return { ok: false, durationMs: 0, error: "Blog not found." };

  const result = await revalidate({
    tags: blogTags(blog.slug),
    trigger: "MANUAL",
    entityType: "Blog",
    entityId: id,
    actorId: session.userId,
  });

  revalidatePath("/revalidation");
  return result;
}

export async function revalidateAllStale(): Promise<{
  ok: boolean;
  attempted: number;
  failed: number;
  remaining: number;
  error?: string;
}> {
  const session = await getSession();
  if (!session) {
    return { ok: false, attempted: 0, failed: 0, remaining: 0, error: "Not signed in." };
  }

  const stale = await findStaleContent();
  const batch = stale.slice(0, MAX_STALE_PER_RUN);

  const started = Date.now();
  let attempted = 0;
  let failed = 0;
  for (const item of batch) {
    if (Date.now() - started > STALE_RUN_BUDGET_MS) break;
    const result = await revalidate({
      tags: blogTags(item.slug),
      trigger: "MANUAL",
      entityType: item.type,
      entityId: item.id,
      actorId: session.userId,
    });
    attempted += 1;
    if (!result.ok) failed += 1;
  }

  revalidatePath("/revalidation");
  return {
    ok: failed === 0,
    attempted,
    failed,
    remaining: stale.length - (attempted - failed),
  };
}
