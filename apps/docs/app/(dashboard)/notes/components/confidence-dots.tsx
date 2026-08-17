"use client";

import { useState, useTransition } from "react";
import { CONF_LABELS } from "@/lib/notes/query";
import { cn } from "@/lib/utils";
import { useRate } from "./vault-provider";

/**
 * The confidence control on a question: a word and a row of dots that cycles.
 *
 * Four glyphs for a five-value scale, deliberately. CONF_LABELS opens on
 * `unrated`, which is the *absence* of a rating — an empty row says exactly
 * that, and a fifth glyph would mean `solid`, the top of the scale, could never
 * fill the row it lives in. So the glyphs count the four ratings above zero and
 * the accessible name carries the word itself.
 *
 * A `<button>`, not the mockup's `<div>`: outside the revise queue this is the
 * only way to change a rating, so it has to be reachable by Tab and it has to
 * announce what it currently reads before anyone commits to pressing it.
 */
export function ConfidenceDots({ nodeId, value }: { nodeId: string; value: number }) {
  const rate = useRate();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // No local copy of the rating, optimistic or otherwise. `useRate` writes it
  // into the vault's own ratings overlay, so the prop this reads is already the
  // new value on the very next render — and so are the folder percentage, the
  // child-row label and the `conf:` filter, from the same number. A refused write
  // takes it back out again, which is the rollback the optimistic hook used to
  // give us, for the whole screen instead of for this control.
  const shown = value;
  const label = CONF_LABELS[shown] ?? CONF_LABELS[0];

  return (
    <span className="nt-conf">
      <span>{label}</span>
      {/* Beside the word rather than instead of it: `aria-label` below is built
          from `label`, so replacing the visible text left the accessible name
          announcing one thing and the screen saying another. */}
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
