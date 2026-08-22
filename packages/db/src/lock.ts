import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./index";

// Correctness is the atomic `updateMany` WHERE clause — never read then write.
// The TTL only reclaims a lock whose holder died before releasing it.
export async function acquireLock(
  key: string,
  ttlMs = 60_000,
): Promise<null | (() => Promise<void>)> {
  const now = new Date();
  const holder = randomBytes(8).toString("hex");
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    // The primary key makes a second concurrent create throw.
    await prisma.jobLock.create({
      data: { key, lockedAt: now, lockedBy: holder, expiresAt },
    });
    return () => releaseLock(key, holder);
  } catch {
    const stolen = await prisma.jobLock.updateMany({
      where: { key, expiresAt: { lt: now } },
      data: { lockedAt: now, lockedBy: holder, expiresAt },
    });
    if (stolen.count === 0) return null;
    return () => releaseLock(key, holder);
  }
}

// Guarded on `lockedBy` so a caller whose lock was stolen cannot release the new holder's.
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
