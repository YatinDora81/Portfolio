import { verifyPreviewToken } from "@repo/shared/preview-token";
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";

/**
 * Redeem a preview link.
 *
 * Draft Mode rather than a `?preview=<jwt>` query parameter, and this is not a
 * style choice. Route caching in this app is configured statically — a page
 * declares its `revalidate` at build time — and no query parameter can make an
 * already-cached route render dynamically. Draft Mode is the mechanism Next
 * ships for exactly this: enabling it opts every subsequent request out of the
 * cache for that browser and nobody else's.
 *
 * So the link is a one-shot key, not the access itself. This route trades a
 * signed 30-minute token for the Draft Mode cookie, and from then on it is the
 * COOKIE that data reads check via `(await draftMode()).isEnabled`. Nothing
 * downstream ever looks at a URL to decide whether to show a draft.
 *
 * `jose` verification is Node crypto, and this repo does not run anything on
 * the edge runtime.
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // One answer for every rejection — bad signature, expired, wrong purpose,
  // or a `PREVIEW_SECRET` that is not configured in this environment at all.
  const claims = await verifyPreviewToken(token);
  if (!claims) {
    return NextResponse.json({ error: "Invalid or expired preview token" }, { status: 401 });
  }

  const dm = await draftMode();
  dm.enable();

  // `encodeURIComponent`, even though the slug arrived inside a token we signed
  // ourselves: it is the difference between a path segment and a redirect an
  // attacker chooses. A slug of `/evil.example` would otherwise send the
  // visitor off-site with the draft cookie already set.
  const destination = claims.type === "Blog" ? `/blog/${encodeURIComponent(claims.slug)}` : "/";

  // Deliberately the last statement and deliberately outside any try/catch:
  // `redirect()` works by throwing a NEXT_REDIRECT signal, so a catch block
  // around it would swallow the redirect and turn this into a blank 200.
  redirect(destination);
}
