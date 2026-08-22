import { after } from "next/server";
import { MessageStatus, prisma } from "db";
import { checkRateLimit } from "db/rate-limit";
import { env } from "@repo/config/env";
import { sendEmail } from "@repo/email/send";
import { renderNotificationEmail } from "@repo/email/templates";
import { sha256 } from "@repo/shared/crypto";
import { FLAG_KEYS, flagValue } from "@repo/shared/flags";
import { verifyFormTimestamp } from "@repo/shared/form-token";
import { logger } from "@repo/shared/logger";
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD, scoreSpam } from "@repo/shared/spam";
import { verifyTurnstile } from "@repo/shared/turnstile";
import { getFlags } from "@/lib/flags";

/**
 * Public, unauthenticated write endpoint — the only one that reaches
 * contactMessage — so every field is bounded and typed here. A truthiness
 * check alone let a caller store megabytes, a non-string, or a bogus address
 * that makes the message impossible to reply to.
 */
const MAX = { name: 100, email: 254, purpose: 100, message: 5000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 3_600_000;

/** Non-strings collapse to "" so they fail the required check. */
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

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

// Platform-written headers only: nothing strips an inbound `cf-connecting-ip`, so trusting it would let a caller pick its own rate-limit bucket.
function clientIp(headers: Headers): string | null {
  const direct = headers.get("x-real-ip")?.trim();
  if (direct) return direct;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

// Order matters: every Chromium UA also says "Safari", and Edge says both.
function coarseUa(ua: string): { deviceType: string | null; browser: string | null } {
  const s = ua.toLowerCase();
  if (!s) return { deviceType: null, browser: null };

  const deviceType = /ipad|tablet|kindle|silk|playbook|android(?!.*mobi)/.test(s)
    ? "tablet"
    : /mobi|iphone|ipod|blackberry|windows phone|opera mini/.test(s)
      ? "mobile"
      : "desktop";

  const browser = /edg(?:e|a|ios)?\//.test(s)
    ? "Edge"
    : /opr\/|opera/.test(s)
      ? "Opera"
      : /firefox|fxios/.test(s)
        ? "Firefox"
        : /chrome|crios|chromium/.test(s)
          ? "Chrome"
          : /safari/.test(s)
            ? "Safari"
            : "Other";

  return { deviceType, browser };
}

function countryOf(headers: Headers): string | null {
  const raw = headers.get("x-vercel-ip-country") ?? "";
  return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
}

export async function POST(request: Request) {
  if (!flagValue(await getFlags(), FLAG_KEYS.CONTACT_FORM)) {
    return Response.json(
      { error: "The contact form is paused right now. Email works." },
      { status: 503 },
    );
  }

  const raw = await readCapped(request, 64_000);
  if (raw === null) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // A malformed body is the caller's fault — 400, not 500.
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const name = str(b.name);
  const email = str(b.email);
  const message = str(b.message);
  const purpose = str(b.purpose);

  // Hashed on the next line and never held past it: the raw address is not stored, not logged, not sent anywhere.
  const ip = clientIp(request.headers);
  const ipKey = ip ? sha256(`contact:${ip}`).slice(0, 32) : null;

  const { allowed, count } = ipKey
    ? await checkRateLimit(`contact:${ipKey}`, RATE_LIMIT, RATE_WINDOW_MS)
    : { allowed: true, count: 0 };
  if (!allowed) {
    return Response.json(
      { error: "That's a lot of messages in one hour. Try again later, or email me directly." },
      { status: 429 },
    );
  }

  const turnstile = await verifyTurnstile(str(b.turnstileToken) || null);
  const elapsedMs = verifyFormTimestamp(
    FORM_TOKEN_FIELD in b ? str(b[FORM_TOKEN_FIELD]) : undefined,
  );
  const verdict = scoreSpam({
    name,
    email,
    body: message,
    honeypot: str(b[HONEYPOT_FIELD]),
    elapsedMs,
    turnstile,
    submissionsThisHour: count,
  });

  if (!name || !email || !message) {
    return Response.json({ error: "Name, email, and message are required" }, { status: 400 });
  }
  if (
    name.length > MAX.name ||
    email.length > MAX.email ||
    message.length > MAX.message ||
    purpose.length > MAX.purpose
  ) {
    return Response.json({ error: "One or more fields exceed the maximum length" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  const { deviceType, browser } = coarseUa(request.headers.get("user-agent") ?? "");

  try {
    // Only accept a purpose the site actually offers, so the column can't be
    // used as free-form storage.
    let safePurpose: string | null = null;
    if (purpose) {
      const known = await prisma.contactPurpose.findFirst({
        where: { label: purpose },
        select: { label: true },
      });
      safePurpose = known?.label ?? null;
    }

    const country = countryOf(request.headers);
    const referrer = request.headers.get("referer")?.slice(0, 512) || null;

    const created = await prisma.contactMessage.create({
      data: {
        name,
        email,
        purpose: safePurpose,
        message,
        status: verdict.isSpam ? MessageStatus.SPAM : MessageStatus.UNREAD,
        // The legacy `read` column drives the unread badge, which only UNREAD may light up.
        read: verdict.isSpam,
        spamScore: verdict.score,
        spamReasons: verdict.reasons,
        country,
        deviceType,
        browser,
        referrer,
      },
      select: { id: true },
    });

    if (!verdict.isSpam) {
      after(async () => {
        try {
          const to = env.NOTIFY_EMAIL_TO ?? env.SMTP_EMAIL;
          if (!to) return;

          const { subject, html, text } = renderNotificationEmail({
            id: created.id,
            name,
            email,
            message,
            purpose: safePurpose,
            country,
            deviceType,
            spamScore: verdict.score,
            spamReasons: verdict.reasons,
          });

          const sent = await sendEmail({ to, subject, html, text, replyTo: email });
          if (!sent.ok) {
            logger.error("contact", "notification send failed", {
              id: created.id,
              error: sent.error,
            });
            return;
          }
          if (sent.messageId) {
            await prisma.contactMessage.update({
              where: { id: created.id },
              data: { notificationMessageId: sent.messageId },
            });
          }
        } catch (e) {
          logger.error("contact", "notification failed", {
            error: e instanceof Error ? e.message : "unknown",
          });
        }
      });
    }

    // A flagged message gets this same response; anything else is a feedback loop for tuning past the scorer.
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Failed to send message" }, { status: 500 });
  }
}
