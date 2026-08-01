import { prisma } from "db";
import { NextRequest, NextResponse } from "next/server";
import { githubHandle, refreshGithubActivity } from "../../../lib/github";

if (!process.env.REVALIDATE_SECRET) throw new Error("REVALIDATE_SECRET environment variable is required");
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

/**
 * Forces a poll of the contribution mirror, on demand from the admin. The
 * automatic path is a 20h-gated `after()` in the homepage render; this is the
 * door for "update it now", and it deliberately skips that gate.
 *
 * It lives here rather than in the admin because the merge and the archive both
 * belong to the site — the same split, and the same shared secret, as
 * /api/revalidate. The handle is resolved from the SocialLink row instead of
 * being posted in, so the admin cannot aim this at an arbitrary account.
 */
export async function POST(request: NextRequest) {
  let secret: unknown;
  try {
    ({ secret } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (secret !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const link = await prisma.socialLink.findFirst({ where: { iconKey: "github" } });
  const handle = githubHandle(link?.href);
  if (!handle) {
    return NextResponse.json({ error: "No GitHub social link to read a handle from" }, { status: 404 });
  }

  // False covers every failure the same way — offline, rate-limited, renamed
  // account, short payload — and in all of them nothing was written, so the
  // stored archive is still whatever it was before the request.
  const refreshed = await refreshGithubActivity(handle);
  if (!refreshed) {
    return NextResponse.json(
      { error: "Could not read contribution data; stored history is unchanged.", handle },
      { status: 502 },
    );
  }

  return NextResponse.json({ refreshed: true, handle });
}
