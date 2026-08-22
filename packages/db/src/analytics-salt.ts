import "server-only";
import { randomBytes } from "node:crypto";
import { sha256 } from "@repo/shared/crypto";
import { toDateKey } from "@repo/shared/dates";
import { prisma } from "./index";

const SALT_TTL_MS = 172_800_000;
const SESSION_WINDOW_MS = 1_800_000;
const HASH_CHARS = 32;

const cache = new Map<string, string>();

function remember(dateKey: string, salt: string): string {
  cache.set(dateKey, salt);
  if (cache.size > 3) {
    const oldest = [...cache.keys()].sort()[0];
    if (oldest) cache.delete(oldest);
  }
  return salt;
}

async function readSalt(dateKey: string): Promise<string | null> {
  const row = await prisma.analyticsSalt.findUnique({
    where: { dateKey },
    select: { salt: true },
  });
  return row?.salt ?? null;
}

// Never log it, never send it to a client, and never derive it from the date —
// a predictable salt makes every hash brute-forceable back to an IP.
export async function getDailySalt(now = new Date()): Promise<string> {
  const dateKey = toDateKey(now);

  const cached = cache.get(dateKey);
  if (cached) return cached;

  const existing = await readSalt(dateKey);
  if (existing) return remember(dateKey, existing);

  try {
    const created = await prisma.analyticsSalt.create({
      data: { dateKey, salt: randomBytes(32).toString("hex") },
      select: { salt: true },
    });
    return remember(dateKey, created.salt);
  } catch {
    // Lost the create race: the winner's salt is the one already stamped into today's hashes.
    const winner = await readSalt(dateKey);
    if (!winner) throw new Error("analytics salt unavailable");
    return remember(dateKey, winner);
  }
}

/** Dropping the salt is what makes the hashes made with it irreversible, to us included. */
export async function pruneOldSalts(now = new Date()): Promise<number> {
  const { count } = await prisma.analyticsSalt.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - SALT_TTL_MS) } },
  });
  cache.clear();
  return count;
}

export function computeVisitorHash(salt: string, ip: string, ua: string): string {
  return sha256(`${salt}:${ip}:${ua}:yatindora.in`).slice(0, HASH_CHARS);
}

/** A 30-minute bucket stands in for a cookie: no identifier ever reaches the browser. */
export function computeSessionHash(visitorHash: string, now = new Date()): string {
  return sha256(`${visitorHash}:${Math.floor(now.getTime() / SESSION_WINDOW_MS)}`).slice(
    0,
    HASH_CHARS,
  );
}
