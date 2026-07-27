import { prisma } from "db";

interface UtmPayload {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  messageId?: string | null;
  path?: string | null;
}

/**
 * Truncate rather than reject: a genuinely long user-agent should still be
 * recorded, but nothing here may write unbounded text. The browser-side
 * sessionStorage gate is a UX nicety — anyone can POST this directly — so the
 * real limits live in this file.
 */
function clean(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s.slice(0, max) : null;
}

/** Repeat hits with an identical fingerprint inside this window are dropped. */
const DEDUP_MINUTES = 10;

export async function POST(request: Request) {
  // Cheapest win: stop a huge body before request.json() buffers it.
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > 4096) {
    return Response.json({ skipped: true, reason: "Payload too large" }, { status: 413 });
  }

  let body: UtmPayload;
  try {
    body = (await request.json()) as UtmPayload;
  } catch {
    return Response.json({ skipped: true, reason: "Invalid JSON body" }, { status: 400 });
  }

  const source = clean(body.source);
  const medium = clean(body.medium);
  const campaign = clean(body.campaign);
  const content = clean(body.content, 512);
  const term = clean(body.term);
  const messageId = clean(body.messageId);
  const path = clean(body.path, 512);

  // Insert when source+medium+campaign are present; content is optional.
  if (!source || !medium || !campaign) {
    return Response.json(
      { skipped: true, reason: "Missing required utm_source/utm_medium/utm_campaign" },
      { status: 200 },
    );
  }

  const referrer = clean(request.headers.get("referer"), 512);
  const userAgent = clean(request.headers.get("user-agent"), 512);

  try {
    // Server-side dedup, since the client gate is trivially bypassed.
    const since = new Date(Date.now() - DEDUP_MINUTES * 60 * 1000);
    const duplicate = await prisma.utmTracker.findFirst({
      where: { source, medium, campaign, content, messageId, path, visitedAt: { gte: since } },
      select: { id: true },
    });
    if (duplicate) {
      return Response.json({ skipped: true, reason: "Duplicate within window" }, { status: 200 });
    }

    await prisma.utmTracker.create({
      data: { source, medium, campaign, content, term, messageId, path, referrer, userAgent },
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Failed to track UTM hit" }, { status: 500 });
  }
}
