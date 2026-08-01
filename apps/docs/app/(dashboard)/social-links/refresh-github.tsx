"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconBrandGithub, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { refreshGithub } from "@/lib/actions/github";

/**
 * The contribution graph in the contact section is served from an archive in
 * Postgres, topped up automatically about once a day by the site's own render.
 * This is the "do it now" door — for after a burst of commits, or after the
 * mirror has been down and the graph has gone stale.
 *
 * Deliberately outside the save bar: it stages nothing and edits nothing. It
 * asks the site to go and read GitHub, and a failure leaves the stored history
 * untouched, so there is nothing here to undo or publish.
 */
export function RefreshGithubButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await refreshGithub());
          })
        }
      >
        <IconBrandGithub size={13} stroke={1.5} />
        {pending ? "Reading GitHub…" : "Refresh GitHub data"}
      </Button>

      {result?.ok && (
        <span style={{ color: "var(--dim)", fontSize: 12.5 }}>
          <IconCheck size={12} stroke={2} style={{ display: "inline", verticalAlign: "-1px" }} /> Archive
          updated. Publish to push it live.
        </span>
      )}
      {result && !result.ok && (
        <span style={{ color: "var(--danger, #c2410c)", fontSize: 12.5 }}>
          <IconAlertTriangle size={12} stroke={2} style={{ display: "inline", verticalAlign: "-1px" }} />{" "}
          {result.error} Stored history is unchanged.
        </span>
      )}
    </div>
  );
}
