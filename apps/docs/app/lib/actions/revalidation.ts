"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { ALL_KNOWN_TAGS, blogTags } from "@repo/shared/tags";
import { getSession } from "@/lib/session";
import { revalidate } from "@/lib/revalidation";
import { findStaleContent } from "@/lib/stale";

/**
 * The admin's manual cache controls.
 *
 * Every export here begins with the session check, and that is not ceremony: a
 * `"use server"` export compiles to a public POST endpoint addressable by its
 * action id, reachable by anyone who can reach the origin whether or not they
 * ever loaded the admin UI. Middleware does not run for a server-action POST,
 * and `(dashboard)/layout.tsx` gates pages rather than actions, so this call is
 * the only thing between the internet and the ability to flush the site.
 *
 * These return `{ ok: false }` rather than redirecting the way the older action
 * files do — every caller here is a button that needs an answer to render, and
 * a redirect thrown out of a fetch-triggered action is not one.
 */

/** Per-row tags are unbounded, so they are matched by prefix rather than enumerated. */
const ROW_TAG = /^(?:blog|project):[A-Za-z0-9._-]{1,200}$/;

/** One round trip per item, each capped at 8s by `revalidate`, so the batch has to be bounded twice over — see `revalidateAllStale`. */
const MAX_STALE_PER_RUN = 10;
const STALE_RUN_BUDGET_MS = 20_000;

/**
 * Flush an explicit set of paths and tags.
 *
 * The arguments arrive from a client component, which means they arrive from
 * whoever is posting — the allow-list below is what stops this from being a
 * "revalidate any string you like" endpoint. Unknown entries are dropped rather
 * than forwarded. The leading-slash check earns its place for a quieter reason
 * than it looks: `revalidatePath("blog/x")` does not throw, it prefixes the
 * string verbatim into a tag no route carries, so the call returns 200 and
 * flushes nothing. A silent miss reported as a success is exactly the failure
 * this whole phase exists to end.
 */
export async function revalidateNow(input: {
  paths?: string[];
  tags?: string[];
}): Promise<{ ok: boolean; durationMs: number; httpStatus?: number; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, durationMs: 0, error: "Not signed in." };

  const knownTags = new Set(ALL_KNOWN_TAGS);
  const tags = (input.tags ?? []).filter((t) => knownTags.has(t) || ROW_TAG.test(t));
  const paths = (input.paths ?? []).filter((p) => p.startsWith("/"));

  // An empty set after filtering is NOT forwarded: the public route reads
  // "no paths, no tags" as the legacy full-site flush, so a request made
  // entirely of rejected strings would flush everything instead of nothing.
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

/**
 * Flush the whole site — the homepage, /sitemap.xml and every /blog/<slug>.
 *
 * Passes no paths and no tags, which is the entire point: /api/revalidate reads
 * an empty request as the layout flush (`revalidatePath("/", "layout")`), the
 * only shape that reaches routes no tag covers. Sending `["/"]` instead takes
 * the per-path branch, where a bare `revalidatePath("/")` emits only the
 * `_N_T_/` tag — a tag no other route carries — so the sitemap and every post
 * stay stale. That is the bug the public route's own comment records as already
 * fixed once, and routing this tile through `revalidateNow` reintroduced it.
 *
 * `revalidateNow` cannot be the caller here: it rejects an empty set on purpose,
 * so that a request made entirely of unknown strings cannot flush everything.
 */
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

/** Flush one blog post and the index it appears in. */
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

/**
 * Flush what the stale detector reports, one at a time, up to a bounded batch.
 *
 * Bounded because the worst case is the case this page exists for: with the
 * public app unreachable every iteration burns the full 8s timeout, so an
 * unbounded fan-out over ten posts is eighty seconds of sequential waiting. The
 * request dies at the platform's function limit, the caller sees a 504, and the
 * trailing `revalidatePath` never runs — the run that most needed to report
 * something reports nothing. `remaining` is what makes a capped run honest: the
 * UI can say how much is left and the admin clicks again.
 *
 * Two bounds, not one. The count caps a healthy run; the wall clock is what
 * actually saves an unhealthy one, since a single slow item can eat the budget
 * long before the count is reached. It is checked before starting a round trip,
 * so the true ceiling is the budget plus one timeout.
 */
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
  // Sequential on purpose. `Promise.all` here would open one fetch per stale
  // post at the live site simultaneously, which is a self-inflicted burst
  // against production for no gain — nothing downstream waits on this finishing
  // sooner, and each iteration also writes two rows.
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
  // `ok` stays "every attempt landed" — a short run is not a failed one, and
  // `remaining` is the field that says there is more to do.
  // `attempted - failed` and not `attempted`: an item whose flush failed is
  // still stale, so counting it as done would report "nothing left to do" while
  // leaving the site serving the old copy.
  return {
    ok: failed === 0,
    attempted,
    failed,
    remaining: stale.length - (attempted - failed),
  };
}
