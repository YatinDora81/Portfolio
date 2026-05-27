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
        if (!result.trackingEnabled) {
          setMessage("Sheet reloaded (Supabase tracking not configured)");
        } else if (result.updated > 0) {
          setMessage(
            `Synced ${result.updated} open${result.updated === 1 ? "" : "s"} from Supabase → Sheet`,
          );
        } else {
          setMessage(
            `Sheet up to date · ${result.supabaseRows} tracking row${result.supabaseRows === 1 ? "" : "s"}`,
          );
        }
        router.refresh();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Sync failed");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={onRefresh}
        title="Sync Supabase open counts to Google Sheet, then reload"
      >
        {isPending ? (
          <IconLoader2 size={14} className="animate-spin" />
        ) : (
          <IconRefresh size={14} />
        )}
        {isPending ? "Syncing…" : "Sync & Refresh"}
      </Button>
      {message && (
        <p className="text-[10px] text-muted-foreground max-w-[14rem] text-right leading-snug">
          {message}
        </p>
      )}
    </div>
  );
}
