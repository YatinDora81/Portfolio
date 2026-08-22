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

/**
 * The publishing controls: run the due queue, push one row live now, or move a
 * row along the DRAFT → SCHEDULED → PUBLISHED → ARCHIVED lifecycle.
 *
 * Every export opens with the session check, and it is the only thing standing
 * here. A `"use server"` export compiles to a public POST endpoint addressable
 * by its action id; middleware does not run for a server-action POST, and
 * `(dashboard)/layout.tsx` gates pages, not actions. Without that first line,
 * `setBlogStatus` would let anyone who can reach the origin publish a draft.
 *
 * Every write below is an `updateMany` with the precondition in its WHERE
 * clause, never a bare `update`. See `packages/db/src/publish-due.ts` for the
 * full argument — the short version is that two callers can arrive at the same
 * row at the same time, and the database is the only place that can arbitrate
 * between them.
 */

/**
 * Save status and flush status are two separate facts, exactly as `setFlag` in
 * ./flags.ts returns them, and for the same reason. By the time revalidation
 * runs the row is already committed: answering `ok: false` because the flush
 * failed tells an admin to retry a write that succeeded, and answering `ok: true`
 * alone tells them a post is live when the public site is still serving the
 * cached page without it. Both halves get their own field.
 */
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

/**
 * `publishAt` arrives as an ISO string from a client component, which means it
 * arrives from whoever is posting — `new Date("next tuesday")` is an Invalid
 * Date, and Prisma turns that into an error deep in the driver rather than a
 * sentence anyone can act on. Parsed and rejected here instead.
 */
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
    // Three distinct meanings, and the editor needs all three: absent leaves the
    // column alone, null (or "") clears it, a string sets it.
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

    // SCHEDULED without a date is the quiet disaster: nothing is ever due, so
    // `publishDueContent` never matches the row and the post sits in a state
    // whose whole promise is that it will go out on its own.
    if (when === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishAt"],
        message: "Scheduling a post needs a publish date.",
      });
      return;
    }

    // A date in the past is not a schedule, it is a publish — and one that
    // takes effect on whichever request happens to run the queue next, which is
    // a confusing way to publish something. Say so and make them choose.
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

/** The same phrasing `setFlag` uses, so a failed flush reads identically wherever it surfaces. */
function flushError(result: RevalidateResult): string | undefined {
  if (result.ok) return undefined;
  return (
    result.error ??
    (result.httpStatus != null
      ? `Failed with HTTP ${result.httpStatus} and no error body.`
      : "The flush failed, and returned no error text.")
  );
}

/**
 * Run the due queue on demand.
 *
 * The same work the admin-load trigger does in the background, exposed as a
 * button for the case that matters most: an admin who scheduled something for
 * five minutes ago and wants to watch it go out rather than trust that a
 * request will come along. Ungated on purpose — it calls `publishDueContent`
 * directly rather than `maybePublishDue`, because the whole point of pressing
 * the button is to skip the "we checked recently" memo.
 */
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

  // Sequential, not `Promise.all`: each call is an HTTP round trip to the public
  // app capped at 8s, and each writes a log row whose order is how the
  // revalidation page reads the run back. A due batch is realistically one or
  // two rows — this fires on an admin page load, so the queue never has time to
  // grow — and firing them in parallel would only reorder the evidence.
  const flushFailures: string[] = [];
  for (const item of items) {
    const itemTags =
      item.type === "Blog"
        ? // A blog always has its slug here; `slug` is nullable on the type only
          // because Project has no slug column. If one were somehow missing, the
          // index tag still flushes the list the post appears in, which is a far
          // better failure than an invented `blog:undefined` tag.
          item.slug
          ? blogTags(item.slug)
          : [tags.blogIndex()]
        : // Projects are tagged by id, never slug — Project has no slug.
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

  // `ok` stays true even when a flush failed: the rows are published and
  // committed, and re-running would republish nothing. This signature has no
  // separate `revalidated` field, so the failure is reported through `error`
  // rather than being swallowed — a post that is live in the database and
  // missing from the site is the one outcome nobody must have to guess at.
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

/**
 * ⚠️ `Blog.publishedAt` is the editorial date the article prints, not a
 * lifecycle timestamp — an author may have back-dated it deliberately. It is
 * only overwritten when it sits in the future, because `publicContentWhere`
 * filters on `publishedAt: { lte: now }` and a post dated next Tuesday would be
 * PUBLISHED and still invisible. Same rule as `publishDueContent`; the full
 * argument lives there.
 */
function blogPublishStamp(current: Date, now: Date): { publishedAt: Date } | Record<string, never> {
  return current.getTime() > now.getTime() ? { publishedAt: now } : {};
}

/** Project's `publishedAt` is nullable and arrived with the lifecycle, so null must be stamped as well. */
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
      // Cleared, not left behind: the editor renders `publishAt` as "goes live
      // Friday", and a post that is already live showing a future go-live date
      // is a lie the admin has no way to resolve.
      publishAt: null,
      ...blogPublishStamp(blog.publishedAt, now),
    },
  });

  // `updateMany` guarded on the id rather than a bare `update`, so a row deleted
  // between the read and the write is a sentence instead of a thrown P2025 that
  // reaches the admin as a generic action failure.
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
      // An omitted `publishAt` leaves the column alone, the way an omitted note
      // does in `setFlag`. Flipping a scheduled post back to DRAFT to fix a typo
      // must not throw away the date the author picked — and a stale date on a
      // non-SCHEDULED row is inert, because every due query requires
      // `status: "SCHEDULED"` before it looks at the time.
      ...(publishAt === undefined ? {} : { publishAt }),
      ...(status === "PUBLISHED" ? blogPublishStamp(blog.publishedAt, now) : {}),
    },
  });

  if (updated.count === 0) {
    return { ok: false, revalidated: false, error: "That blog no longer exists." };
  }

  // A move to SCHEDULED changes nothing a visitor can see — the post is not live
  // yet — but it still flushes, because the admin's own preview reads through
  // the same tags, and because a no-op flush costs one request while a missing
  // one costs a stale page nobody thinks to look at.
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

/** Flush a blog's tags and refresh the admin routes that render it. Shared so every blog transition flushes the same set. */
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
  // `projectTags(id)` — the id, not a slug. Project has no slug column, so
  // there is nothing else stable to key a tag on.
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
