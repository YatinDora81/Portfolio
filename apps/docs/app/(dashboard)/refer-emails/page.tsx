import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSheetContacts } from "@/lib/sheet";
import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { ReferEmailsList } from "./list";
import { ReferEmailsRefreshButton } from "./refresh-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
      <div>
        <PageHeader
          title="Refer Emails"
          description="Outreach contacts synced from Google Sheets"
        />
        <Card className="p-8 border-destructive/30 bg-destructive/[0.03]">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-destructive/10 p-2.5 text-destructive shrink-0">
              <IconAlertTriangle size={20} stroke={1.5} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-destructive">
                Could not load the campaign sheet
              </h3>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <p className="text-xs text-muted-foreground mt-3">
                Check Google Sheet vars (<code className="font-mono text-foreground/80">GOOGLE_SHEET_*</code>,{" "}
                <code className="font-mono text-foreground/80">GOOGLE_CLIENT_EMAIL</code>,{" "}
                <code className="font-mono text-foreground/80">GOOGLE_PRIVATE_KEY</code>) and Supabase tracking (
                <code className="font-mono text-foreground/80">SUPABASE_URL</code>,{" "}
                <code className="font-mono text-foreground/80">SUPABASE_SERVICE_ROLE_KEY</code>) in{" "}
                <code className="font-mono text-foreground/80">apps/docs/.env</code>.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Refer Emails"
        description={`${data.stats.total} contacts in "${data.sheetTitle}" · synced from Google Sheets`}
      >
        <ReferEmailsRefreshButton />
        <Link href={data.sheetUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <IconExternalLink size={14} /> Open Sheet
          </Button>
        </Link>
      </PageHeader>

      <ReferEmailsList
        contacts={data.contacts}
        stats={data.stats}
        fetchedAt={data.fetchedAt}
      />
    </div>
  );
}
