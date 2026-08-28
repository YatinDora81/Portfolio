"use server";

import { prisma } from "db";
import type { ContentStatus } from "db";
import { publishDueContent } from "db/publish-due";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { blogTags, projectTags, tags } from "@repo/shared/tags";
import { getSession } from "@/lib/session";
import { revalidate } from "@/lib/revalidation";
import type { RevalidateResult } from "@/lib/revalidation";

type StatusResult = {
  ok: boolean;
  revalidated: boolean;
  revalidateError?: string;
  error?: string;
};

const CONTENT_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHED",
  "ARCHIVED",
] as const satisfies readonly ContentStatus[];

function parsePublishAt(raw: string | null | undefined): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const when = new Date(trimmed);
  return Number.isNaN(when.getTime()) ? null : when;
}

const StatusInput = z
  .object({
    id: z.string().min(1, "A row id is required."),
    status: z.enum(CONTENT_STATUSES, {
      errorMap: () => ({
        message: "Status must be one of DRAFT, SCHEDULED, PUBLISHED or ARCHIVED.",
      }),
    }),
    // absent leaves the column alone, null or "" clears it
    publishAt: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const raw = value.publishAt?.trim();
    const when = parsePublishAt(value.publishAt);

    if (raw && when === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishAt"],
        message: "That publish date could not be read as a date.",
      });
      return;
    }

    if (value.status !== "SCHEDULED") return;

    if (when === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishAt"],
        message: "Scheduling a post needs a publish date.",
      });
      return;
    }

    if (when.getTime() <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishAt"],
        message: "A scheduled publish date has to be in the future. Use Publish now instead.",
      });
    }
  })
  .transform((value) => ({
    id: value.id,
    status: value.status,
    publishAt: value.publishAt === undefined ? undefined : parsePublishAt(value.publishAt),
  }));

const IdInput = z.object({ id: z.string().min(1, "A row id is required.") });

function firstMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

function flushError(result: RevalidateResult): string | undefined {
  if (result.ok) return undefined;
  return (
    result.error ??
    (result.httpStatus != null
      ? `Failed with HTTP ${result.httpStatus} and no error body.`
      : "The flush failed, and returned no error text.")
  );
}

export async function runDuePublish(): Promise<{
  ok: boolean;
  published: number;
  error?: string;
}> {
  const session = await getSession();
  if (!session) return { ok: false, published: 0, error: "Not signed in." };

  let items;
  try {
    items = await publishDueContent();
  } catch (e) {
    return {
      ok: false,
      published: 0,
      error: e instanceof Error ? e.message : "The publish run failed.",
    };
  }

  if (items.length === 0) return { ok: true, published: 0 };

  const flushFailures: string[] = [];
  for (const item of items) {
    const itemTags =
      item.type === "Blog"
        ?
          item.slug
          ? blogTags(item.slug)
          : [tags.blogIndex()]
        :
          projectTags(item.id);

    const result = await revalidate({
      tags: itemTags,
      trigger: "SCHEDULED_PUBLISH",
      entityType: item.type,
      entityId: item.id,
      actorId: session.userId,
    });
    if (!result.ok) flushFailures.push(`${item.type} ${item.slug ?? item.id}`);
  }

  if (items.some((i) => i.type === "Blog")) revalidatePath("/blogs");
  if (items.some((i) => i.type === "Project")) revalidatePath("/projects");
  revalidatePath("/dashboard");
  revalidatePath("/revalidation");

  return {
    ok: true,
    published: items.length,
    ...(flushFailures.length === 0
      ? {}
      : {
          error: `Published ${items.length}, but the cache flush failed for: ${flushFailures.join(", ")}.`,
        }),
  };
}

function blogPublishStamp(current: Date, now: Date): { publishedAt: Date } | Record<string, never> {
  return current.getTime() > now.getTime() ? { publishedAt: now } : {};
}

function projectPublishStamp(
  current: Date | null,
  now: Date,
): { publishedAt: Date } | Record<string, never> {
  return current === null || current.getTime() > now.getTime() ? { publishedAt: now } : {};
}

export async function publishBlogNow(id: string): Promise<StatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, revalidated: false, error: "Not signed in." };

  const parsed = IdInput.safeParse({ id });
  if (!parsed.success) {
    return {
      ok: false,
      revalidated: false,
      error: firstMessage(parsed.error, "That is not a valid blog id."),
    };
  }

  const blog = await prisma.blog.findUnique({
    where: { id: parsed.data.id },
    select: { slug: true, publishedAt: true },
  });
  if (!blog) return { ok: false, revalidated: false, error: "No blog with that id." };

  const now = new Date();
  const updated = await prisma.blog.updateMany({
    where: { id: parsed.data.id },
    data: {
      status: "PUBLISHED",
      publishAt: null,
      ...blogPublishStamp(blog.publishedAt, now),
    },
  });

  // updateMany, not update: a row deleted between read and write is count 0
  if (updated.count === 0) {
    return { ok: false, revalidated: false, error: "That blog no longer exists." };
  }

  return finishBlog(parsed.data.id, blog.slug, session.userId, "CONTENT_SAVE");
}

export async function publishProjectNow(id: string): Promise<StatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, revalidated: false, error: "Not signed in." };

  const parsed = IdInput.safeParse({ id });
  if (!parsed.success) {
    return {
      ok: false,
      revalidated: false,
      error: firstMessage(parsed.error, "That is not a valid project id."),
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.id },
    select: { publishedAt: true },
  });
  if (!project) return { ok: false, revalidated: false, error: "No project with that id." };

  const now = new Date();
  const updated = await prisma.project.updateMany({
    where: { id: parsed.data.id },
    data: {
      status: "PUBLISHED",
      publishAt: null,
      ...projectPublishStamp(project.publishedAt, now),
    },
  });

  if (updated.count === 0) {
    return { ok: false, revalidated: false, error: "That project no longer exists." };
  }

  return finishProject(parsed.data.id, session.userId, "CONTENT_SAVE");
}

export async function setBlogStatus(input: {
  id: string;
  status: string;
  publishAt?: string | null;
}): Promise<StatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, revalidated: false, error: "Not signed in." };

  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      revalidated: false,
      error: firstMessage(parsed.error, "That is not a valid status change."),
    };
  }

  const { id, status, publishAt } = parsed.data;

  const blog = await prisma.blog.findUnique({
    where: { id },
    select: { slug: true, publishedAt: true },
  });
  if (!blog) return { ok: false, revalidated: false, error: "No blog with that id." };

  const now = new Date();
  const updated = await prisma.blog.updateMany({
    where: { id },
    data: {
      status,
      ...(publishAt === undefined ? {} : { publishAt }),
      ...(status === "PUBLISHED" ? blogPublishStamp(blog.publishedAt, now) : {}),
    },
  });

  if (updated.count === 0) {
    return { ok: false, revalidated: false, error: "That blog no longer exists." };
  }

  return finishBlog(id, blog.slug, session.userId, "CONTENT_SAVE");
}

export async function setProjectStatus(input: {
  id: string;
  status: string;
  publishAt?: string | null;
}): Promise<StatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, revalidated: false, error: "Not signed in." };

  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      revalidated: false,
      error: firstMessage(parsed.error, "That is not a valid status change."),
    };
  }

  const { id, status, publishAt } = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { publishedAt: true },
  });
  if (!project) return { ok: false, revalidated: false, error: "No project with that id." };

  const now = new Date();
  const updated = await prisma.project.updateMany({
    where: { id },
    data: {
      status,
      ...(publishAt === undefined ? {} : { publishAt }),
      ...(status === "PUBLISHED" ? projectPublishStamp(project.publishedAt, now) : {}),
    },
  });

  if (updated.count === 0) {
    return { ok: false, revalidated: false, error: "That project no longer exists." };
  }

  return finishProject(id, session.userId, "CONTENT_SAVE");
}

async function finishBlog(
  id: string,
  slug: string,
  actorId: string,
  trigger: "CONTENT_SAVE" | "SCHEDULED_PUBLISH",
): Promise<StatusResult> {
  const result = await revalidate({
    tags: blogTags(slug),
    trigger,
    entityType: "Blog",
    entityId: id,
    actorId,
  });

  revalidatePath("/blogs");
  revalidatePath(`/blogs/${id}`);

  return { ok: true, revalidated: result.ok, ...(result.ok ? {} : { revalidateError: flushError(result) }) };
}

async function finishProject(
  id: string,
  actorId: string,
  trigger: "CONTENT_SAVE" | "SCHEDULED_PUBLISH",
): Promise<StatusResult> {
  const result = await revalidate({
    tags: projectTags(id),
    trigger,
    entityType: "Project",
    entityId: id,
    actorId,
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);

  return { ok: true, revalidated: result.ok, ...(result.ok ? {} : { revalidateError: flushError(result) }) };
}
