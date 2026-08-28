import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "./index";

export async function acquireLock(
  key: string,
  ttlMs = 60_000,
): Promise<null | (() => Promise<void>)> {
  const now = new Date();
  const holder = randomBytes(8).toString("hex");
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    // the primary key makes a second concurrent create throw
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

// guarded on `lockedBy` so a stolen lock is not released
async function releaseLock(key: string, holder: string): Promise<void> {
  try {
    await prisma.jobLock.deleteMany({ where: { key, lockedBy: holder } });
  } catch (e) {
    console.error("[lock] release failed", key, e);
  }
}
