import "server-only";

import { prisma } from "db";
import type {
  RevalidationLogModel,
  RevalidationStatus,
  RevalidationTrigger,
  TagStateModel,
} from "db";
import { env } from "@repo/config/env";
import { logger } from "@repo/shared/logger";

export type RevalidationLog = RevalidationLogModel;
export type TagState = TagStateModel;

export type RevalidateResult = {
  ok: boolean;
  durationMs: number;
  httpStatus?: number;
  error?: string;
};

export type RevalidateOpts = {
  paths?: string[];
  tags?: string[];
  trigger: RevalidationTrigger;
  entityType?: string;
  entityId?: string;
  actorId?: string;
};

const TIMEOUT_MS = 8000;

const ERROR_BODY_CHARS = 300;

/** Never throws: callers invoke this after the content save has already committed, so an escaping error would report a committed save as a failure. */
export async function revalidate(opts: RevalidateOpts): Promise<RevalidateResult> {
  const paths = opts.paths ?? [];
  const tags = opts.tags ?? [];

  const started = Date.now();
  let status: RevalidationStatus = "SUCCESS";
  let httpStatus: number | undefined;
  let error: string | undefined;

  try {
    const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
    const res = await fetch(`${site}/api/revalidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": env.REVALIDATE_SECRET,
      },
      body: JSON.stringify({ paths, tags }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    httpStatus = res.status;
    if (!res.ok) {
      status = "FAILED";
      error = `HTTP ${res.status}: ${(await res.text()).slice(0, ERROR_BODY_CHARS)}`;
    }
  } catch (e) {
    // `AbortSignal.timeout` rejects with a DOMException named "TimeoutError"; an externally aborted request gives "AbortError".
    const name = e instanceof Error ? e.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    status = timedOut ? "TIMEOUT" : "FAILED";
    error = timedOut
      ? `Timed out after ${TIMEOUT_MS}ms`
      : e instanceof Error
        ? e.message
        : String(e);
  }

  const durationMs = Date.now() - started;

  try {
    const now = new Date();

    await prisma.revalidationLog.create({
      data: {
        paths,
        tags,
        trigger: opts.trigger,
        entityType: opts.entityType,
        entityId: opts.entityId,
        actorId: opts.actorId,
        status,
        httpStatus,
        durationMs,
        error,
      },
    });

    for (const tag of tags) {
      if (status === "SUCCESS") {
        await prisma.tagState.upsert({
          where: { tag },
          create: { tag, lastSuccessAt: now, lastAttemptAt: now, consecutiveFails: 0 },
          update: { lastSuccessAt: now, lastAttemptAt: now, consecutiveFails: 0 },
        });
      } else {
        await prisma.tagState.upsert({
          where: { tag },
          // The epoch, not `now`: seeding `lastSuccessAt` with the current time would mark a tag that has never once succeeded as fresh.
          create: { tag, lastSuccessAt: new Date(0), lastAttemptAt: now, consecutiveFails: 1 },
          update: { lastAttemptAt: now, consecutiveFails: { increment: 1 } },
        });
      }
    }
  } catch (e) {
    logger.error("revalidate", "failed to write log", { err: String(e) });
  }

  return {
    ok: status === "SUCCESS",
    durationMs,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(error === undefined ? {} : { error }),
  };
}

export type RevalidationHealth = {
  total: number;
  success: number;
  failed: number;
  timeout: number;
  /** 0..1, and 1 when nothing was attempted. */
  successRate: number;
  p95DurationMs: number;
};

export async function readHealth(sinceDays = 7): Promise<RevalidationHealth> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const [grouped, durations] = await Promise.all([
    prisma.revalidationLog.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.revalidationLog.findMany({
      where: { createdAt: { gte: since } },
      select: { durationMs: true },
      orderBy: { durationMs: "asc" },
    }),
  ]);

  let success = 0;
  let failed = 0;
  let timeout = 0;
  for (const row of grouped) {
    if (row.status === "SUCCESS") success = row._count._all;
    else if (row.status === "FAILED") failed = row._count._all;
    else if (row.status === "TIMEOUT") timeout = row._count._all;
  }
  const total = success + failed + timeout;

  const n = durations.length;
  // `noUncheckedIndexedAccess` types the indexed read as possibly undefined even after the clamp, hence the `?? 0`.
  const idx = Math.min(Math.max(Math.ceil(0.95 * n) - 1, 0), n - 1);
  const p95DurationMs = n === 0 ? 0 : (durations[idx]?.durationMs ?? 0);

  return {
    total,
    success,
    failed,
    timeout,
    successRate: total === 0 ? 1 : success / total,
    p95DurationMs,
  };
}

export async function readRecentLogs(limit = 100): Promise<RevalidationLog[]> {
  return prisma.revalidationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function readTagStates(): Promise<TagState[]> {
  return prisma.tagState.findMany({ orderBy: { tag: "asc" } });
}
