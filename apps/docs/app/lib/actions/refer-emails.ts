"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "db";
import { invalidateSheetCache } from "@/lib/sheet";
import { syncOpenTrackingToSheet, type TrackingSyncResult } from "@/lib/tracking-sync";

interface SyncReferEmailsResult extends TrackingSyncResult {
  utmChecked: boolean;
  utmStats?: {
    total: number;
    withContent: number;
    latestVisitedAt: string | null;
  };
}

/** Supabase open tracking → Google Sheet, then reload refer-emails (same as `npm run sync` in bulk-email-sender). */
export async function syncReferEmails(): Promise<SyncReferEmailsResult> {
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
