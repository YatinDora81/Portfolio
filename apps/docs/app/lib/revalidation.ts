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

/**
 * Every revalidation the admin app asks for goes through here, and every one of
 * them leaves a row behind.
 *
 * The failure this replaces: `publishSite` fired a fetch at the public app and
 * threw the answer away. A wrong secret, an unreachable origin and a genuine
 * flush were the same silent non-event, so "the site is stale" had no evidence
 * anywhere and no way to tell which of the three had happened.
 */

/** Re-exported under the bare model name so a page can type its props without reaching into `db`'s generated `*Model` names. */
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

/** Beyond this the public app is not going to answer, and the admin's save is being held hostage waiting. */
const TIMEOUT_MS = 8000;

/** Enough of the body to name the failure, short enough that a 500 HTML page does not become the log row. */
const ERROR_BODY_CHARS = 300;

/**
 * Ask the public app to flush, then record what happened.
 *
 * THE CRITICAL PROPERTY: this never throws. Callers invoke it *after* a content
 * save has already committed, so an exception escaping here would propagate out
 * of the server action and be reported to the admin as a failed save — a save
 * that is, in fact, already in the database. The admin would then re-submit and
 * the row would be written twice. Every path below therefore returns a
 * `RevalidateResult`; the fetch is wrapped, and the logging block that follows
 * is wrapped separately, because a database hiccup writing the *log* must not
 * undo a save either.
 */
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
      // Read the body before slicing: the public route answers 401 with a JSON
      // `{ error }`, and that sentence is the entire difference between "wrong
      // secret" and "route is broken".
      error = `HTTP ${res.status}: ${(await res.text()).slice(0, ERROR_BODY_CHARS)}`;
    }
  } catch (e) {
    // `AbortSignal.timeout` rejects with a DOMException named "TimeoutError";
    // an externally aborted request gives "AbortError". Both mean "we never got
    // an answer", which is a different operational problem from a 500 — the
    // site may well have flushed and simply not told us in time.
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

    // Pattern B: upsert keyed on `tag`, the model's primary key. Re-running the
    // same revalidation converges on one row per tag instead of appending, so
    // the staleness comparison in stale.ts always reads a single current answer.
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
          // The epoch, not `now`, on first failure: `lastSuccessAt` is the
          // right-hand side of every staleness comparison, and seeding it with
          // the current time would mark a tag that has never once succeeded as
          // freshly up to date.
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
  /** 0..1. Defined as 1 when nothing was attempted — an empty window is not a broken one. */
  successRate: number;
  p95DurationMs: number;
};

/** Aggregate outcomes over the last `sinceDays` days. The query lives here, not in the page, so the dashboard and any future alert read the same numbers. */
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
  // `noUncheckedIndexedAccess` makes the indexed read `{ durationMs } | undefined`
  // even after the clamp, so the `?? 0` is the compiler's price, not a real branch.
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

/** Newest first — the order the dashboard's table wants, and the order that makes "did my last publish land?" the top row. */
export async function readRecentLogs(limit = 100): Promise<RevalidationLog[]> {
  return prisma.revalidationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function readTagStates(): Promise<TagState[]> {
  return prisma.tagState.findMany({ orderBy: { tag: "asc" } });
}
