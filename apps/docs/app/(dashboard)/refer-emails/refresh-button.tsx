"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncReferEmails } from "@/lib/actions/refer-emails";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";

export function ReferEmailsRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const onRefresh = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await syncReferEmails();
        if (result.error) {
          setMessage(result.error);
          return;
        }
        if (!result.trackingEnabled) {
          setMessage("Sheet reloaded (Supabase tracking not configured)");
        } else if (result.updated > 0) {
          setMessage(
            `Synced ${result.updated} open${result.updated === 1 ? "" : "s"} from Supabase → Sheet${result.utmChecked ? " · UTM checked" : ""}`,
          );
        } else {
          setMessage(
            `Sheet up to date · ${result.supabaseRows} tracking row${result.supabaseRows === 1 ? "" : "s"}${result.utmChecked ? ` · UTM hits: ${result.utmStats?.total ?? 0}` : ""}`,
          );
        }
        router.refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Sync failed");
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={onRefresh}
        title="Sync Supabase open counts to Google Sheet, then reload"
      >
        {isPending ? (
          <IconLoader2 size={14} className="spin" />
        ) : (
          <IconRefresh size={14} />
        )}
        {isPending ? "Syncing…" : "Sync & refresh"}
      </Button>
      {message && (
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            color: "var(--faint)",
            maxWidth: "16rem",
            textAlign: "right",
            lineHeight: 1.6,
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
