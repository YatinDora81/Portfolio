import { env } from "@repo/config/env";
import { safeEqual } from "@repo/shared/crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * Caps, not a security boundary — the secret below is the only thing gating
 * this route. These exist so that one accepted request cannot be turned into
 * tens of thousands of cache writes, and so a hostile body is rejected before
 * the loop rather than during it.
 */
const MAX_ENTRIES = 100;
const MAX_ENTRY_LENGTH = 512;

const bodySchema = z.object({
  secret: z.string().optional(),
  paths: z.array(z.string().max(MAX_ENTRY_LENGTH)).max(MAX_ENTRIES).default([]),
  tags: z.array(z.string().max(MAX_ENTRY_LENGTH)).max(MAX_ENTRIES).default([]),
});

/**
 * The admin app's one door into this deployment's cache.
 *
 * Two shapes, deliberately: an empty body (`{ secret }` and nothing else) is the
 * legacy full flush that Publish has always sent, and every existing caller
 * still speaks it. A body carrying `paths`/`tags` flushes only those, which is
 * what a per-post publish wants instead of dumping the whole site.
 *
 * The secret may arrive in the `x-revalidate-secret` header or in the body.
 * The header is preferred — it keeps the credential out of anything that logs
 * request bodies — but the body form cannot be dropped without breaking the
 * three callers that use it.
 */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    // An unparseable body threw before the secret check and surfaced as a bare
    // 500 with no body at all.
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { paths, tags } = parsed.data;

  // `??` and not `||`: an empty header is still a header the caller chose to
  // send, and it must fail rather than quietly fall through to the body.
  const presented = request.headers.get("x-revalidate-secret") ?? parsed.data.secret;
  if (!presented || !safeEqual(presented, env.REVALIDATE_SECRET)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  try {
    if (paths.length === 0 && tags.length === 0) {
      // "layout" flushes every route nested under the root layout — the homepage,
      // /sitemap.xml AND /blog/<slug>. A bare revalidatePath("/") only emits the
      // `_N_T_/` tag, which no other route carries, so blog posts and the sitemap
      // stayed stale until their 24h window expired.
      revalidatePath("/", "layout");
    } else {
      for (const path of paths) revalidatePath(path);
      // Two arguments — Next 16 dropped the one-arg call. The profile'd form
      // marks the entry stale without dragging a render along with it, which is
      // what a fan-out of tags wants.
      for (const tag of tags) revalidateTag(tag, "max");
    }
  } catch (e) {
    // Not path validation: `revalidatePath("blog/x")` does not throw. Next 16
    // prefixes it straight into the implicit tag `_N_T_blog/x`, which no route
    // carries, so the call matches nothing and this route still answers 200 —
    // a flush that did exactly nothing, reported as a success. That silence is
    // why the caller drops paths without a leading slash before sending them,
    // rather than relying on an error coming back from here.
    //
    // What does reach this catch is the cache write itself failing. The caller
    // gets the reason; a 500 with an empty body would send whoever triggered
    // the publish looking at the database instead.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Revalidation failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ revalidated: true, now: Date.now(), paths, tags });
}
