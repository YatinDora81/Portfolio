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
  error?: string;
}

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
