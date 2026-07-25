import Link from "next/link";
import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSheetContacts } from "@/lib/sheet";
import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { ReferEmailsList } from "./list";
import { ReferEmailsRefreshButton } from "./refresh-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CODE: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)" };

function decodeUrlSafeBase64(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(normalized + padding, "base64").toString("utf-8").trim().toLowerCase();
    return decoded.includes("@") ? decoded : null;
  } catch {
    return null;
  }
}

export default async function ReferEmailsPage() {
  let data;
  let error: string | null = null;
  try {
    data = await getSheetContacts();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error || !data) {
    return (
      <div className="view">
        <PageHeader
          eyebrow="outreach · campaign sheet"
          title="Refer emails"
          description="Outreach contacts synced from Google Sheets."
        />
        <Card>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div
              style={{
                background: "var(--bad-soft)",
                color: "var(--bad)",
                borderRadius: 10,
                padding: 9,
                display: "grid",
                placeItems: "center",
                flex: "none",
              }}
            >
              <IconAlertTriangle size={18} stroke={1.6} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="card-t" style={{ color: "var(--bad)" }}>
                Could not load the campaign sheet
              </div>
              <p style={{ fontSize: 13, color: "var(--dim)", marginTop: 5 }}>{error}</p>
              <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 12, lineHeight: 1.7 }}>
                Check Google Sheet vars (<code style={CODE}>GOOGLE_SHEET_*</code>,{" "}
                <code style={CODE}>GOOGLE_CLIENT_EMAIL</code>,{" "}
                <code style={CODE}>GOOGLE_PRIVATE_KEY</code>) and Supabase tracking (
                <code style={CODE}>SUPABASE_URL</code>,{" "}
                <code style={CODE}>SUPABASE_SERVICE_ROLE_KEY</code>) in{" "}
                <code style={CODE}>apps/docs/.env</code>.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const utmHits = await prisma.utmTracker.findMany({
    where: { content: { not: null } },
    select: { content: true, visitedAt: true },
    orderBy: { visitedAt: "desc" },
    take: 20000,
  });

  const visitsByEmail = new Map<string, { count: number; lastVisitedAt: string }>();
  for (const hit of utmHits) {
    if (!hit.content) continue;
    const decoded = decodeUrlSafeBase64(hit.content);
    if (!decoded) continue;
    const existing = visitsByEmail.get(decoded);
    if (!existing) {
      visitsByEmail.set(decoded, {
        count: 1,
        lastVisitedAt: hit.visitedAt.toISOString(),
      });
    } else {
      existing.count += 1;
      if (new Date(hit.visitedAt).getTime() > new Date(existing.lastVisitedAt).getTime()) {
        existing.lastVisitedAt = hit.visitedAt.toISOString();
      }
    }
  }

  const contactsWithPortfolioVisits = data.contacts.map((c) => {
    const v = visitsByEmail.get(c.email.toLowerCase());
    return {
      ...c,
      portfolioVisitCount: v?.count ?? 0,
      lastPortfolioVisitedAt: v?.lastVisitedAt ?? null,
    };
  });

  return (
    <div className="view wide">
      <PageHeader
        eyebrow="outreach · campaign sheet"
        title="Refer emails"
        description={`${data.stats.total} contacts in "${data.sheetTitle}", synced from Google Sheets with open and portfolio-visit tracking.`}
      >
        <ReferEmailsRefreshButton />
        <Link href={data.sheetUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <IconExternalLink size={14} /> Open sheet
          </Button>
        </Link>
      </PageHeader>

      <ReferEmailsList
        contacts={contactsWithPortfolioVisits}
        stats={data.stats}
        fetchedAt={data.fetchedAt}
      />
    </div>
  );
}
