"use client";

import { useCallback, useState } from "react";
import { ConfigCard, type ConfigGroup, type ControlContext } from "@/components/config/config-card";
import { PreviewFrame } from "@/components/preview";
import { BackgroundPreview } from "@/components/preview/background";
import { cn } from "@/lib/utils";
import {
  BACKGROUND_LAYERS, clampNumber, toBackgroundVersion, type BackgroundVersion,
} from "@/lib/site-config-keys";
import { BackgroundTerrainCard } from "./terrain-card";

/**
 * The client shell around the background: the layer choice, the terrain dials,
 * and the pane that draws whichever of the two is picked.
 *
 * It lives beside the tiles rather than in a file of its own because the tile IS
 * the condition everything else on the page hangs off — the terrain card dims
 * against it and the pane switches engines on it, so the pick and the state
 * holding it are one thing.
 *
 * Two ConfigCards, deliberately, and therefore two save footers. They are not
 * one card because they are not one decision: the tile is a site-wide switch,
 * and the eight dials underneath it are tuning for one of the two things it can
 * switch to. Each posts only its own keys, so saving the tuning can never flip
 * the layer back to what it was when this page loaded.
 */
export function BackgroundConsole({ version, terrain }: {
  /** What the `backgroundVersion` row holds right now. */
  version: BackgroundVersion;
  /** The eight terrain rows, already defaulted by the page. */
  terrain: Record<string, string>;
}) {
  const [picked, setPicked] = useState<BackgroundVersion>(version);
  // The terrain fields as they are being dragged, so the pane moves with the
  // slider instead of waiting for a save. ConfigCard still owns the values —
  // this is a copy for drawing, and it is never posted from here.
  const [draft, setDraft] = useState<Record<string, string>>(terrain);
  const onTerrainDraft = useCallback((next: Record<string, string>) => setDraft(next), []);

  const pct = (key: string) => clampNumber(key, draft[key] ?? "") / 100;
  const flag = (key: string) => (draft[key] || "on") !== "off";

  // The pane is ahead of the site if ANY of the nine rows has moved, not just
  // the tile: a strength drag changes what is drawn without changing which
  // layer is drawing it, and a label that only watched the tile would call that
  // "live".
  const ahead =
    picked !== version ||
    Object.keys(terrain).some((k) => (draft[k] ?? "") !== (terrain[k] ?? ""));

  return (
    <>
      {/* `.view` has no gap of its own — the page spaces its own blocks, at 14. */}
      <div style={{ marginBottom: 14 }}>
        <BackgroundLayerCard saved={version} onPick={setPicked} />
      </div>

      <BackgroundTerrainCard
        values={terrain}
        saved={version}
        picked={picked}
        onDraftChange={onTerrainDraft}
      />

      <PreviewFrame
        label={`Background — ${picked}${ahead ? " · draft, not what visitors see" : " · live"}`}
      >
        <BackgroundPreview
          version={picked}
          strength={pct("terrainStrength")}
          veil={pct("terrainVeil")}
          cell={clampNumber("terrainCell", draft["terrainCell"] ?? "")}
          levels={clampNumber("terrainLevels", draft["terrainLevels"] ?? "")}
          minor={pct("terrainMinor")}
          major={pct("terrainMajor")}
          channel={flag("terrainChannel")}
          interactive={flag("terrainInteractive")}
        />
      </PreviewFrame>
    </>
  );
}

/**
 * The one row that decides which field sits under every page.
 *
 * A ConfigCard rather than a second save path, exactly as the Projects layout
 * tiles are: `backgroundVersion` is a SiteConfig row like any other, so it keeps
 * the card that already owns dirty tracking, Reset, Save and Save & Publish —
 * and, critically, posts only the key it was given.
 *
 * The override is not optional here. ConfigCard's native `versionTiles` fallback
 * is wired to PROJECT_LAYOUTS, so drawing this key without one would offer the
 * reader a choice between the ledger and the build log.
 */
export function BackgroundLayerCard({ saved, onPick }: {
  /** What the row currently holds — the tile that gets the live marker. */
  saved: BackgroundVersion;
  /** The draft, so the card and the pane below can follow it before a save. */
  onPick: (v: BackgroundVersion) => void;
}) {
  const handleDraft = useCallback(
    (values: Record<string, string>) => onPick(toBackgroundVersion(values["backgroundVersion"])),
    [onPick],
  );

  const groups: ConfigGroup[] = [
    {
      title: "Layer",
      blurb: "One row, and every page reads it — the portfolio, both blog pages, the 404 and the error page. Picking a tile changes nothing until you save: the pane at the bottom follows the pick, visitors follow the row.",
      keys: ["backgroundVersion"],
    },
  ];

  return (
    <ConfigCard
      groups={groups}
      values={{ backgroundVersion: saved }}
      onDraftChange={handleDraft}
      controls={{ backgroundVersion: (ctx) => <LayerTiles ctx={ctx} saved={saved} /> }}
    />
  );
}

function LayerTiles({ ctx, saved }: { ctx: ControlContext; saved: BackgroundVersion }) {
  const picked = toBackgroundVersion(ctx.value);

  return (
    <div className="pvr-grid" role="radiogroup" aria-label="Background layer">
      {BACKGROUND_LAYERS.map((l) => {
        const on = picked === l.value;
        const live = saved === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={cn("pvr", on && "on")}
            onClick={() => ctx.set(l.value)}
          >
            <span className="pvr-k">{l.value}</span>
            <span className="pvr-m">
              <span className="pvr-n">{l.name}</span>
              <span className={cn("pvr-st", live && "live")}>
                {live
                  ? "live on the site"
                  : on
                    ? "picked — goes live when you save"
                    : "not in use"}
              </span>
              <span className="pvr-d">{l.detail}</span>
            </span>
            {/* Repeats the tile's own state at the right edge, where a reader
                scanning for "what do visitors get" stops. */}
            {live && <span className="dot" aria-hidden="true" style={{ background: "var(--good)" }} />}
          </button>
        );
      })}
    </div>
  );
}
