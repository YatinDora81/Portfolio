"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setConfidence } from "@/lib/actions/notes";
import { CONF_LABELS } from "@/lib/notes/query";
import { cn } from "@/lib/utils";

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
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The action revalidates and the prop comes back holding the truth. Until it
  // does, the dots follow the click instead of sitting still for a round trip —
  // this control is usually pressed two or three times in a row.
  const [shown, setShown] = useOptimistic(value);

  const label = CONF_LABELS[shown] ?? CONF_LABELS[0];

  return (
    <span className="nt-conf">
      {error ? (
        <span className="nt-bad" role="alert">{error}</span>
      ) : (
        <span>{label}</span>
      )}
      <button
        type="button"
        className={cn("nt-dots", shown <= 1 ? "lo" : shown === 2 ? "mid" : "hi")}
        disabled={pending}
        aria-label={`Confidence: ${label}, click to change`}
        onClick={() =>
          start(async () => {
            const next = (shown + 1) % CONF_LABELS.length;
            setShown(next);
            setError(null);
            const r = await setConfidence(nodeId, next);
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
