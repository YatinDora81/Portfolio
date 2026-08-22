import "server-only";
import { env } from "@repo/config/env";
import { logger } from "./logger";
import type { TurnstileState } from "./spam";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

// Cloudflare says "not verified" for a bad secret exactly as it does for a bad
// token. A mistyped secret key is our fault, so those come back "unknown".
const OUR_FAULT = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

/**
 * `"unknown"` means "we cannot say" — no secret configured, Cloudflare down,
 * slow or answering nonsense. It must never cost a visitor anything: an outage
 * at Cloudflare is not evidence of a bot.
 */
export async function verifyTurnstile(token: string | null, ip?: string): Promise<TurnstileState> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return "unknown";

  // The widget only renders when the site key is set, and the two keys are
  // independent. Without one there was never a token to submit, so a missing
  // token is our deployment gap rather than anything the sender did.
  if (!token) return env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "missing" : "unknown";

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn("turnstile", "siteverify returned a non-2xx", { status: res.status });
      return "unknown";
    }

    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null || !("success" in data)) return "unknown";

    const success = data.success;
    if (typeof success !== "boolean") return "unknown";
    if (success) return "ok";

    const codes = "error-codes" in data ? data["error-codes"] : undefined;
    if (Array.isArray(codes) && codes.some((c) => typeof c === "string" && OUR_FAULT.has(c))) {
      logger.error("turnstile", "siteverify rejected our credentials, skipping the check");
      return "unknown";
    }

    return "failed";
  } catch (e) {
    logger.warn("turnstile", "siteverify unreachable, skipping the check", {
      error: e instanceof Error ? e.name : "unknown",
    });
    return "unknown";
  }
}
