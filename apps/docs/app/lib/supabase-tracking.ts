import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function isSupabaseTrackingEnabled(): boolean {
  if (process.env.TRACKING_ENABLED === "false") return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export interface OpenTrackingRow {
  message_id: string;
  email: string;
  open_count: number;
  last_opened_at: string | null;
  created_at: string;
}

export async function listAllOpenTracking(): Promise<OpenTrackingRow[]> {
  const supabase = getClient();
  const pageSize = 1000;
  const all: OpenTrackingRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("email_open_tracking")
      .select("message_id, email, open_count, last_opened_at, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const batch = (data || []) as OpenTrackingRow[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export function aggregateOpenTrackingByEmail(
  rows: OpenTrackingRow[],
): Map<string, { openCount: number; lastOpenedAt?: Date }> {
  const map = new Map<string, { openCount: number; lastOpenedAt?: Date }>();

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email) continue;

    const lastAt = row.last_opened_at ? new Date(row.last_opened_at) : undefined;
    const existing = map.get(email);

    if (!existing) {
      map.set(email, {
        openCount: row.open_count ?? 0,
        lastOpenedAt: lastAt,
      });
      continue;
    }

    existing.openCount += row.open_count ?? 0;
    if (lastAt && (!existing.lastOpenedAt || lastAt > existing.lastOpenedAt)) {
      existing.lastOpenedAt = lastAt;
    }
  }

  return map;
}
