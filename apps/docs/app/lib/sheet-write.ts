import "server-only";
import { GoogleSpreadsheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { JWT } from "google-auth-library";
const WRITE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

interface CachedRow {
  row: GoogleSpreadsheetRow;
  email: string;
  openCount: number;
  lastOpenedAt?: Date;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const cache = new Map<string, CachedRow>();
let initialized = false;

async function initWritableSheet(): Promise<void> {
  if (initialized) return;

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tabName = process.env.GOOGLE_SHEET_TAB || "Contacts";
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");
  if (!clientEmail) throw new Error("Missing GOOGLE_CLIENT_EMAIL");
  if (!privateKeyRaw) throw new Error("Missing GOOGLE_PRIVATE_KEY");

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const jwt = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: WRITE_SCOPES,
  });

  const doc = new GoogleSpreadsheet(sheetId, jwt);
  await doc.loadInfo();

  const ws = doc.sheetsByTitle[tabName] ?? doc.sheetsByIndex[0];
  if (!ws) throw new Error(`Sheet tab "${tabName}" not found`);

  const rows = await ws.getRows();
  cache.clear();
  for (const row of rows) {
    const email = String(row.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email) continue;
    cache.set(email, {
      row,
      email,
      openCount: Number(row.get("openCount") || 0) || 0,
      lastOpenedAt: parseDate(row.get("lastOpenedAt") as string | undefined),
    });
  }

  initialized = true;
}

export function resetWritableSheetCache(): void {
  cache.clear();
  initialized = false;
}

export type SheetOpenUpdateResult = "updated" | "not_found" | "unchanged";

export async function updateSheetOpenStats(
  email: string,
  stats: { openCount: number; lastOpenedAt?: Date },
): Promise<SheetOpenUpdateResult> {
  await initWritableSheet();
  const key = email.trim().toLowerCase();
  const cached = cache.get(key);
  if (!cached) return "not_found";

  const sameCount = cached.openCount === stats.openCount;
  const cachedLast = cached.lastOpenedAt?.getTime();
  const statsLast = stats.lastOpenedAt?.getTime();
  if (sameCount && cachedLast === statsLast) return "unchanged";

  cached.row.set("openCount", String(stats.openCount));
  cached.row.set(
    "lastOpenedAt",
    stats.lastOpenedAt ? stats.lastOpenedAt.toISOString() : "",
  );
  cached.row.set("updatedAt", new Date().toISOString());
  await cached.row.save();

  cached.openCount = stats.openCount;
  cached.lastOpenedAt = stats.lastOpenedAt;
  return "updated";
}
