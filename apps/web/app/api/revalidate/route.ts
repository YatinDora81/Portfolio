import { env } from "@repo/config/env";
import { safeEqual } from "@repo/shared/crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const MAX_ENTRIES = 100;
const MAX_ENTRY_LENGTH = 512;

const bodySchema = z.object({
  secret: z.string().optional(),
  paths: z.array(z.string().max(MAX_ENTRY_LENGTH)).max(MAX_ENTRIES).default([]),
  tags: z.array(z.string().max(MAX_ENTRY_LENGTH)).max(MAX_ENTRIES).default([]),
});

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { paths, tags } = parsed.data;

  // ?? not ||: an empty header must fail, not fall through
  const presented = request.headers.get("x-revalidate-secret") ?? parsed.data.secret;
  if (!presented || !safeEqual(presented, env.REVALIDATE_SECRET)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  try {
    if (paths.length === 0 && tags.length === 0) {
      // "layout" flushes every route under the root layout, not just /
      revalidatePath("/", "layout");
    } else {
      for (const path of paths) revalidatePath(path);
      for (const tag of tags) revalidateTag(tag, "max");
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Revalidation failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ revalidated: true, now: Date.now(), paths, tags });
}
