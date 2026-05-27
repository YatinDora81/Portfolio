"use server";

import { revalidatePath } from "next/cache";
import { invalidateSheetCache } from "@/lib/sheet";
import { syncOpenTrackingToSheet, type TrackingSyncResult } from "@/lib/tracking-sync";

/** Supabase open tracking → Google Sheet, then reload refer-emails (same as `npm run sync` in bulk-email-sender). */
export async function syncReferEmails(): Promise<TrackingSyncResult> {
  const result = await syncOpenTrackingToSheet();
  invalidateSheetCache();
  revalidatePath("/refer-emails");
  return result;
}
