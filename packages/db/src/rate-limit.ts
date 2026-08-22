import "server-only";
import { logger } from "@repo/shared/logger";
import { prisma } from "./index";

const DAY_MS = 86_400_000;

/** Fixed-window counter. Every failure path returns `allowed: true` rather than closing the form. */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; count: number }> {
  const windowAt = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  try {
    const bucket = await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 0, windowAt },
      update: {},
    });

    if (bucket.windowAt.getTime() !== windowAt.getTime()) {
      // Guarded on the *old* windowAt: a concurrent roll-over matches nothing rather than resetting its count.
      await prisma.rateLimitBucket.updateMany({
        where: { key, windowAt: bucket.windowAt },
        data: { count: 0, windowAt },
      });
    }

    const { count } = await prisma.rateLimitBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    return { allowed: count <= limit, count };
  } catch (e) {
    logger.error("rate-limit", "check failed, failing open", {
      error: e instanceof Error ? e.message : "unknown",
    });
    return { allowed: true, count: 0 };
  }
}

export async function pruneRateLimits(olderThanMs = DAY_MS): Promise<number> {
  try {
    const { count } = await prisma.rateLimitBucket.deleteMany({
      where: { windowAt: { lt: new Date(Date.now() - olderThanMs) } },
    });
    return count;
  } catch (e) {
    logger.error("rate-limit", "prune failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
    return 0;
  }
}
