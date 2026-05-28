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

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UtmPayload;

    const source = clean(body.source);
    const medium = clean(body.medium);
    const campaign = clean(body.campaign);
    const content = clean(body.content);
    const term = clean(body.term);
    const messageId = clean(body.messageId);
    const path = clean(body.path);

    // Insert when source+medium+campaign are present; content is optional.
    if (!source || !medium || !campaign) {
      return Response.json(
        { skipped: true, reason: "Missing required utm_source/utm_medium/utm_campaign" },
        { status: 200 },
      );
    }

    const referrer = clean(request.headers.get("referer"));
    const userAgent = clean(request.headers.get("user-agent"));

    await prisma.utmTracker.create({
      data: {
        source,
        medium,
        campaign,
        content,
        term,
        messageId,
        path,
        referrer,
        userAgent,
      },
    });

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Failed to track UTM hit" }, { status: 500 });
  }
}
