"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconRefresh, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { refreshGithub } from "@/lib/actions/github";

/**
 * The contribution graph in the contact section is served from an archive in
 * Postgres, topped up automatically about once a day by the site's own render.
 * This is the "do it now" door — for after a burst of commits, or after the
 * mirror has been down and the graph has gone stale.
 *
 * It moved here from /social-links when that route folded into /hero. It is the
 * only manual way to refresh the graph anywhere in the admin, and it belongs
 * beside the tile it refreshes rather than beside a list of links.
 *
 * Deliberately outside the save bar: it stages nothing and edits nothing. It
 * asks the site to go and read GitHub, and a failure leaves the stored history
 * untouched, so there is nothing here to undo or publish.
 */
export function RefreshGithubButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  return (
    <div className="ctc-refresh">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await refreshGithub());
          })
        }
      >
        <IconRefresh size={13} stroke={1.6} className={pending ? "spin" : undefined} />
        {pending ? "Reading GitHub…" : "Refresh now"}
      </Button>

      <span className="ctc-refresh-m" aria-live="polite">
        {result?.ok ? (
          <span style={{ color: "var(--goodT)" }}>
            <IconCheck size={12} stroke={2} style={{ display: "inline", verticalAlign: "-1px" }} />{" "}
            Archive updated. Publish to push it live.
          </span>
        ) : result ? (
          <span style={{ color: "var(--bad)" }}>
            <IconAlertTriangle size={12} stroke={2} style={{ display: "inline", verticalAlign: "-1px" }} />{" "}
            {result.error} Stored history is unchanged.
          </span>
        ) : (
          <>Asks the site to read GitHub now. A failed read writes nothing.</>
        )}
      </span>
    </div>
  );
}
