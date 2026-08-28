"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconRefresh, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { refreshGithub } from "@/lib/actions/github";

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
