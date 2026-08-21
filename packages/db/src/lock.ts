import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./index";

/**
 * "Only one caller does this work" without Redis.
 *
 * Correctness rests entirely on the atomicity of a single `updateMany` WHERE
 * clause: Postgres serialises the row, so of two callers racing for an expired
 * lock exactly one matches a row and the other matches none. Nothing here
 * reads-then-writes, because a read followed by a write is two statements with
 * a gap in the middle and the gap is the bug.
 *
 * The TTL is the safety net, not the mechanism. A serverless invocation that
 * dies mid-work never runs its `finally`, so the lock it holds would be held
 * forever; instead it expires and the next caller steals it.
 */
export async function acquireLock(
  key: string,
  ttlMs = 60_000,
): Promise<null | (() => Promise<void>)> {
  const now = new Date();
  const holder = randomBytes(8).toString("hex");
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    // No row yet. The primary key makes a second concurrent create throw.
    await prisma.jobLock.create({
      data: { key, lockedAt: now, lockedBy: holder, expiresAt },
    });
    return () => releaseLock(key, holder);
  } catch {
    // A row exists — steal it only if it has expired.
    const stolen = await prisma.jobLock.updateMany({
      where: { key, expiresAt: { lt: now } },
      data: { lockedAt: now, lockedBy: holder, expiresAt },
    });
    if (stolen.count === 0) return null;
    return () => releaseLock(key, holder);
  }
}

/**
 * Guarded on `lockedBy` so a slow caller whose lock already expired and was
 * stolen cannot release the new holder's lock on its way out — the one failure
 * mode that turns a lock into a source of the corruption it was added to
 * prevent.
 */
async function releaseLock(key: string, holder: string): Promise<void> {
  try {
    await prisma.jobLock.updateMany({
      where: { key, lockedBy: holder },
      data: { expiresAt: new Date(0) },
    });
  } catch (e) {
    console.error("[lock] release failed", key, e);
  }
}
