import { prisma } from "db";
import { NextRequest, NextResponse } from "next/server";
import { githubHandle, refreshGithubActivity } from "../../../lib/github";

if (!process.env.REVALIDATE_SECRET) throw new Error("REVALIDATE_SECRET environment variable is required");
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

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

  const refreshed = await refreshGithubActivity(handle);
  if (!refreshed) {
    return NextResponse.json(
      { error: "Could not read contribution data; stored history is unchanged.", handle },
      { status: 502 },
    );
  }

  return NextResponse.json({ refreshed: true, handle });
}
