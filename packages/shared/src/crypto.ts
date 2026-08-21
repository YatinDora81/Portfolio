import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison. Use for EVERY secret check — `===` returns as soon
 * as two bytes differ, so the time it takes leaks how long a guess's correct
 * prefix was, and a few thousand requests recover the secret one character at a
 * time.
 *
 * The length check ahead of it is not a leak worth closing: `timingSafeEqual`
 * throws outright on unequal lengths, and a secret's length is not the secret.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
