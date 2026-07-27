import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

if (!process.env.REVALIDATE_SECRET) throw new Error("REVALIDATE_SECRET environment variable is required");
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

export async function POST(request: NextRequest) {
  let secret: unknown;
  try {
    ({ secret } = await request.json());
  } catch {
    // An unparseable body threw before the secret check and surfaced as a bare
    // 500 with no body at all.
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (secret !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  // "layout" flushes every route nested under the root layout — the homepage,
  // /sitemap.xml AND /blog/<slug>. A bare revalidatePath("/") only emits the
  // `_N_T_/` tag, which no other route carries, so blog posts and the sitemap
  // stayed stale until their 24h window expired.
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true, now: Date.now() });
}
