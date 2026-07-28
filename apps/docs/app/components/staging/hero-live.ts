"use client";

import { useStaging } from "./staging-provider";

export interface HeroContentRow {
  id: string;
  version: string;
  intro: string;
  tagline: string;
  /** The sentinel "live" on the served version, NULL on the other. */
  live: string | null;
}

/**
 * The version the site serves *once the staged batch saves* — the pending flip
 * if one exists, otherwise what the database says.
 *
 * Deliberately not derived from `overlay()`. Overlay patches a staged
 * `{ live: true }` onto its row but has no way to clear the other one, so
 * mid-flip both rows read as live and "which one" becomes a coin toss. Reading
 * the op directly is exact, and `HeroCopyCard` guarantees at most one exists by
 * clearing both rows before it stages.
 *
 * Lives here rather than beside the copy card because the preview wrappers need
 * it too: a pane with no version tab of its own has to follow the staged flip,
 * or its "showing N unsaved changes" chip counts a change the pane isn't drawing.
 */
export function useLiveVersion(content: HeroContentRow[]): "v1" | "v2" {
  const { ops } = useStaging();
  const flip = ops.find(
    (op) => op.kind === "update" && op.entity === "heroContent" && op.fields.live === true
  );
  const version =
    flip?.kind === "update"
      ? content.find((c) => c.id === flip.id)?.version
      : content.find((c) => c.live)?.version;
  return version === "v1" ? "v1" : "v2";
}
