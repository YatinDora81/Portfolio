import { prisma } from "db";
import { FLAG_KEYS, flagValue } from "@repo/shared/flags";
import { getFlags } from "@/lib/flags";

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

/**
 * Reads the body with a hard ceiling, streaming so an oversized one is dropped
 * rather than buffered. `content-length` alone is not a guard: it is absent on a
 * chunked request, which let any caller skip the check entirely and hand
 * `request.json()` a body of any size.
 */
async function readCapped(request: Request, cap: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > cap) return null;

  const body = request.body;
  if (!body) return request.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.length + c.length);
      merged.set(acc);
      merged.set(c, acc.length);
      return merged;
    }, new Uint8Array()),
  );
}

export async function POST(request: Request) {
  // 200, not 503: the caller is a fire-and-forget `keepalive` beacon, and an error would log in every visitor's console.
  if (!flagValue(await getFlags(), FLAG_KEYS.ANALYTICS)) {
    return Response.json(
      { skipped: true, reason: "Analytics collection is off" },
      { status: 200 },
    );
  }

  const raw = await readCapped(request, 4096);
  if (raw === null) {
    return Response.json({ skipped: true, reason: "Payload too large" }, { status: 413 });
  }

  let body: UtmPayload;
  try {
    // `?? {}` because a body of literal `null` parses without throwing, and
    // reading a field off it threw a TypeError that surfaced as a bare 500.
    body = (JSON.parse(raw) ?? {}) as UtmPayload;
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
