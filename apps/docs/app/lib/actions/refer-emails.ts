"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "db";
import { getSession } from "@/lib/session";
import { invalidateSheetCache } from "@/lib/sheet";
import { syncOpenTrackingToSheet, type TrackingSyncResult } from "@/lib/tracking-sync";

interface SyncReferEmailsResult extends TrackingSyncResult {
  utmChecked: boolean;
  utmStats?: {
    total: number;
    withContent: number;
    latestVisitedAt: string | null;
  };
  /** Set when the sync was refused outright; the caller renders it verbatim. */
  error?: string;
}

/**
 * Supabase open tracking → Google Sheet, then reload refer-emails (same as
 * `npm run sync` in bulk-email-sender).
 *
 * This one returns its refusal instead of redirecting, unlike the other action
 * modules: its only caller wraps the call in a `try/catch` (refresh-button.tsx),
 * which would swallow the redirect and report a generic "Sync failed". It is
 * also the one action here that writes OUTSIDE Postgres — it updates a Google
 * Sheet under a read-write scope — so leaving it open was the widest of the
 * unauthenticated holes.
 */
export async function syncReferEmails(): Promise<SyncReferEmailsResult> {
  if (!(await getSession())) {
    return {
      supabaseRows: 0,
      uniqueEmails: 0,
      updated: 0,
      skippedNotInStorage: 0,
      errors: 0,
      trackingEnabled: false,
      utmChecked: false,
      error: "Your session has expired — sign in again, then retry the sync.",
    };
  }

  const result = await syncOpenTrackingToSheet();
  let utmChecked = false;
  let utmStats: SyncReferEmailsResult["utmStats"];
  try {
    const [total, withContent, latest] = await Promise.all([
      prisma.utmTracker.count(),
      prisma.utmTracker.count({ where: { content: { not: null } } }),
      prisma.utmTracker.findFirst({
        orderBy: { visitedAt: "desc" },
        select: { visitedAt: true },
      }),
    ]);
    utmChecked = true;
    utmStats = {
      total,
      withContent,
      latestVisitedAt: latest?.visitedAt.toISOString() ?? null,
    };
  } catch {
    // keep sync successful even if utm stats query fails
  }

  invalidateSheetCache();
  revalidatePath("/refer-emails");
  return { ...result, utmChecked, utmStats };
}
