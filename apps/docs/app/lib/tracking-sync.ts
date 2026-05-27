import "server-only";
import {
  aggregateOpenTrackingByEmail,
  isSupabaseTrackingEnabled,
  listAllOpenTracking,
} from "./supabase-tracking";
import { resetWritableSheetCache, updateSheetOpenStats } from "./sheet-write";

export interface TrackingSyncResult {
  supabaseRows: number;
  uniqueEmails: number;
  updated: number;
  skippedNotInStorage: number;
  errors: number;
  trackingEnabled: boolean;
}

/** Same as `bun run sync` in bulk-email-sender: Supabase opens → Google Sheet. */
export async function syncOpenTrackingToSheet(): Promise<TrackingSyncResult> {
  if (!isSupabaseTrackingEnabled()) {
    return {
      supabaseRows: 0,
      uniqueEmails: 0,
      updated: 0,
      skippedNotInStorage: 0,
      errors: 0,
      trackingEnabled: false,
    };
  }

  resetWritableSheetCache();
  const rows = await listAllOpenTracking();
  const byEmail = aggregateOpenTrackingByEmail(rows);

  let updated = 0;
  let skippedNotInStorage = 0;
  let errors = 0;

  for (const [email, stats] of byEmail) {
    try {
      const result = await updateSheetOpenStats(email, stats);
      if (result === "updated") updated++;
      else if (result === "not_found") skippedNotInStorage++;
    } catch {
      errors++;
    }
  }

  return {
    supabaseRows: rows.length,
    uniqueEmails: byEmail.size,
    updated,
    skippedNotInStorage,
    errors,
    trackingEnabled: true,
  };
}
