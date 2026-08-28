import { verifyPreviewToken } from "@repo/shared/preview-token";
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";

// `jose` verification needs Node crypto.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const claims = await verifyPreviewToken(token);
  if (!claims) {
    return NextResponse.json({ error: "Invalid or expired preview token" }, { status: 401 });
  }

  const dm = await draftMode();
  dm.enable();

  const destination = claims.type === "Blog" ? `/blog/${encodeURIComponent(claims.slug)}` : "/";

  redirect(destination);
}
