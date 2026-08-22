import "server-only";
import { env } from "@repo/config/env";
import { logger } from "./logger";
import type { TurnstileState } from "./spam";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

// Cloudflare reports a bad secret exactly as it does a bad token; a mistyped secret is our fault.
const OUR_FAULT = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

export async function verifyTurnstile(token: string | null, ip?: string): Promise<TurnstileState> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return "unknown";

  // No site key means the widget never rendered, so a missing token is our gap, not the sender's.
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
