import "server-only";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export const CONTACT_HEADERS = [
  "sno",
  "name",
  "email",
  "title",
  "company",
  "status",
  "openCount",
  "lastOpenedAt",
  "generatedSubject",
  "generatedBody",
  "sentAt",
  "error",
  "createdAt",
  "updatedAt",
] as const;

export type ContactStatus = "pending" | "sent" | "failed";

export interface SheetContact {
  sno: number;
  name: string;
  email: string;
  title: string;
  company: string;
  status: ContactStatus;
  openCount: number;
  lastOpenedAt: string | null;
  generatedSubject: string | null;
  generatedBody: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SheetStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  totalOpens: number;
  uniqueOpens: number;
}

export interface SheetData {
  contacts: SheetContact[];
  stats: SheetStats;
  sheetTitle: string;
  sheetId: string;
  sheetUrl: string;
  fetchedAt: string;
}

function parseISO(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNumber(value: string | undefined | null, fallback = 0): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function normalizeStatus(value: string | undefined): ContactStatus {
  const v = (value || "pending").toLowerCase();
  if (v === "sent" || v === "failed") return v;
  return "pending";
}

let cached: SheetData | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 40_000;
export const SHEET_SYNC_INTERVAL_MS = 40_000;

export async function getSheetContacts(opts?: {
  force?: boolean;
}): Promise<SheetData> {
  const now = Date.now();
  if (!opts?.force && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

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
    scopes: SCOPES,
  });

  const doc = new GoogleSpreadsheet(sheetId, jwt);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[tabName] ?? doc.sheetsByIndex[0];
  if (!sheet) {
    throw new Error(`Sheet tab "${tabName}" not found in spreadsheet`);
  }

  const rows = await sheet.getRows();

  const contacts: SheetContact[] = rows.map((row) => {
    const get = (k: string) => (row.get(k) as string | undefined) ?? "";
    return {
      sno: toNumber(get("sno"), 0),
      name: get("name"),
      email: get("email").toLowerCase(),
      title: get("title"),
      company: get("company"),
      status: normalizeStatus(get("status")),
      openCount: toNumber(get("openCount"), 0),
      lastOpenedAt: parseISO(get("lastOpenedAt")),
      generatedSubject: get("generatedSubject") || null,
      generatedBody: get("generatedBody") || null,
      sentAt: parseISO(get("sentAt")),
      error: get("error") || null,
      createdAt: parseISO(get("createdAt")),
      updatedAt: parseISO(get("updatedAt")),
    };
  });

  const stats: SheetStats = {
    total: contacts.length,
    sent: 0,
    failed: 0,
    pending: 0,
    totalOpens: 0,
    uniqueOpens: 0,
  };
  for (const c of contacts) {
    if (c.status === "sent") stats.sent++;
    else if (c.status === "failed") stats.failed++;
    else stats.pending++;
    stats.totalOpens += c.openCount;
    if (c.openCount > 0) stats.uniqueOpens++;
  }

  cached = {
    contacts,
    stats,
    sheetTitle: doc.title,
    sheetId,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    fetchedAt: new Date().toISOString(),
  };
  cachedAt = now;
  return cached;
}

export function invalidateSheetCache() {
  cached = null;
  cachedAt = 0;
}
