"use client";

import { useState, useTransition } from "react";
import { CONF_LABELS } from "@/lib/notes/query";
import { cn } from "@/lib/utils";
import { useRate } from "./vault-provider";

export function ConfidenceDots({ nodeId, value }: { nodeId: string; value: number }) {
  const rate = useRate();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const shown = value;
  const label = CONF_LABELS[shown] ?? CONF_LABELS[0];

  return (
    <span className="nt-conf">
      <span>{label}</span>
      {error ? <span className="nt-bad" role="alert">{error}</span> : null}
      <button
        type="button"
        className={cn("nt-dots", shown <= 1 ? "lo" : shown === 2 ? "mid" : "hi")}
        disabled={pending}
        aria-label={`Confidence: ${label}, click to change`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await rate(nodeId, (shown + 1) % CONF_LABELS.length);
            if (!r.ok) setError(r.error);
          })
        }
      >
        {"●".repeat(shown)}
        {"○".repeat(CONF_LABELS.length - 1 - shown)}
      </button>
    </span>
  );
}
