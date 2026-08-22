import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@repo/config/env";
import { safeEqual } from "./crypto";

const MAX_AGE_MS = 2 * 60 * 60 * 1000;

// Instances render and verify on their own clocks; a second of drift is not a bot.
const FUTURE_SKEW_MS = 60_000;

function sign(ts: number, secret: string): string {
  return createHmac("sha256", secret).update(String(ts)).digest("hex");
}

export function signFormTimestamp(ts: number = Date.now()): string | null {
  const secret = env.CONTACT_FORM_HMAC_SECRET;
  if (!secret) return null;
  return `${ts}.${sign(ts, secret)}`;
}

/**
 * Elapsed ms since signing; `"unconfigured"` when there is no secret;
 * `"absent"` when the caller never sent a field at all; `null` for a token that
 * was sent and is malformed, forged, expired or future-dated. Those are four
 * different facts and the scorer prices them differently — nobody is flagged
 * for the server's own missing config, or for a token fetch their browser
 * blocked. Lines up with `SpamInput["elapsedMs"]`.
 */
export function verifyFormTimestamp(
  token: string | null | undefined,
): number | null | "unconfigured" | "absent" {
  const secret = env.CONTACT_FORM_HMAC_SECRET;
  if (!secret) return "unconfigured";
  if (token === undefined) return "absent";
  if (!token) return "absent";

  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const tsPart = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{1,15}$/.test(tsPart)) return null;

  const ts = Number(tsPart);
  if (!Number.isSafeInteger(ts)) return null;
  if (!safeEqual(sig, sign(ts, secret))) return null;

  const now = Date.now();
  if (ts > now + FUTURE_SKEW_MS) return null;
  if (now - ts > MAX_AGE_MS) return null;

  return Math.max(0, now - ts);
}
