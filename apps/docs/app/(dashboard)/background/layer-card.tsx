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

export function BackgroundConsole({ version, terrain }: {
  version: BackgroundVersion;
  terrain: Record<string, string>;
}) {
  const [picked, setPicked] = useState<BackgroundVersion>(version);
  const [draft, setDraft] = useState<Record<string, string>>(terrain);
  const onTerrainDraft = useCallback((next: Record<string, string>) => setDraft(next), []);

  const pct = (key: string) => clampNumber(key, draft[key] ?? "") / 100;
  const flag = (key: string) => (draft[key] || "on") !== "off";

  const ahead =
    picked !== version ||
    Object.keys(terrain).some((k) => (draft[k] ?? "") !== (terrain[k] ?? ""));

  return (
    <>
      {/* .view has no gap of its own */}
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

export function BackgroundLayerCard({ saved, onPick }: {
  saved: BackgroundVersion;
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
            {/* repeats the tile state at the right edge */}
            {live && <span className="dot" aria-hidden="true" style={{ background: "var(--good)" }} />}
          </button>
        );
      })}
    </div>
  );
}
