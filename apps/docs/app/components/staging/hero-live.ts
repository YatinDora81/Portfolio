"use client";

import { useStaging } from "./staging-provider";

export interface HeroContentRow {
  id: string;
  version: string;
  intro: string;
  tagline: string;
  /** sentinel "live" on the served version, NULL on the other */
  live: string | null;
}

// reads the op directly, overlay can't clear the other row mid-flip
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
