"use client";

import { useEffect } from "react";
import { ConfigCard, type ConfigGroup, type ControlContext } from "@/components/config/config-card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { NUMBER_RANGE, clampNumber, type BackgroundVersion } from "@/lib/site-config-keys";
import { IconAlertTriangle } from "@tabler/icons-react";

const DIALS: { key: string; unit: string }[] = [
  { key: "terrainStrength", unit: "%" },
  { key: "terrainVeil", unit: "%" },
  { key: "terrainCell", unit: "px" },
  { key: "terrainLevels", unit: "" },
  { key: "terrainMinor", unit: "%" },
  { key: "terrainMajor", unit: "%" },
];

const FLAGS: Record<string, { on: string; off: string }> = {
  terrainChannel: { on: "Erased", off: "Drawn through" },
  terrainInteractive: { on: "Follows the pointer", off: "Still" },
};

export function BackgroundTerrainCard({ values, saved, picked, onDraftChange }: {
  values: Record<string, string>;
  saved: BackgroundVersion;
  picked: BackgroundVersion;
  onDraftChange: (values: Record<string, string>) => void;
}) {
  const dead = saved === "v1" && picked === "v1";
  const leaving = saved === "v2" && picked === "v1";
  const arriving = saved === "v1" && picked === "v2";

  const blurb = dead
    ? "The lines are the live layer and the tile above still says so, so nothing on this card reaches anyone — these eight rows save fine and are read by nothing. Pick the terrain above to wake them up."
    : leaving
      ? "The terrain is what visitors have now, but the tile above is set to the lines — saving that pick retires every value here without changing one of them."
      : arriving
        ? "The tile above is set to the terrain, but that pick is not saved, so the lines are still what visitors are on and these eight are still read by nobody. Strength multiplies the minor and major lines together, so it is the one to move before either of them."
        : "Six dials for the map and two for what it does while someone is reading over it. Strength multiplies the minor and major lines together, so it is the one to move before either of them.";

  const split = picked !== saved ? (
    <div className="cfg-err" style={{ borderTop: 0 }}>
      <IconAlertTriangle size={14} stroke={1.6} />
      <span>
        {saved === "v1"
          ? "The layer row still says v1. Save & Publish here writes these eight and pushes the site live on the lines — the terrain pick above is its own save, and until you make it none of this is drawn for anyone."
          : "The layer row still says v2. Save & Publish here writes these eight and pushes the site live on the terrain — the lines pick above is its own save, and it is what retires these."}
      </span>
    </div>
  ) : undefined;

  const groups: ConfigGroup[] = [
    {
      title: "The terrain",
      blurb,
      keys: [...DIALS.map((d) => d.key), ...Object.keys(FLAGS)],
      slot: split,
    },
  ];

  const controls: Record<string, (ctx: ControlContext) => React.ReactNode> = {};
  for (const { key, unit } of DIALS) {
    controls[key] = (ctx) => <Dial ctx={ctx} name={key} unit={unit} />;
  }
  for (const key of Object.keys(FLAGS)) {
    controls[key] = (ctx) => <Flag ctx={ctx} words={FLAGS[key]!} />;
  }

  return (
    <ConfigCard
      groups={groups}
      values={values}
      controls={controls}
      isDisabled={() => dead}
      onDraftChange={onDraftChange}
    />
  );
}

function Dial({ ctx, name, unit }: { ctx: ControlContext; name: string; unit: string }) {
  const range = NUMBER_RANGE[name];
  const { set, value, disabled } = ctx;
  const n = clampNumber(name, value);

  // the snap has to reach the draft, not just the thumb
  useEffect(() => {
    if (range && !disabled && String(n) !== value) set(String(n));
  });

  if (!range) return null;
  const id = `dial-${name}`;

  return (
    <div className={cn("f", "sld", disabled && "is-off")}>
      <label htmlFor={id}>{ctx.def.label}</label>
      <div className="sld-row">
        <input
          id={id}
          className="sld-in"
          type="range"
          min={range.min}
          max={range.max}
          step={1}
          value={n}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />

        <span className="sld-v" aria-hidden="true">
          {n}
          {unit && <i className="sld-u">{unit}</i>}
        </span>
      </div>
      <div className="f-hint">{ctx.def.description}</div>
    </div>
  );
}

function Flag({ ctx, words }: { ctx: ControlContext; words: { on: string; off: string } }) {
  // absent row = on, matching what apps/web falls back to
  const on = (ctx.value || "on") !== "off";

  return (
    <div className={cn("f", ctx.disabled && "is-off")}>
      <label>{ctx.def.label}</label>
      <div style={{ height: 36, display: "flex", alignItems: "center" }}>
        <Switch
          checked={on}
          disabled={ctx.disabled}
          onChange={(next) => ctx.set(next ? "on" : "off")}
          label={on ? words.on : words.off}
        />
      </div>
      <div className="f-hint">{ctx.def.description}</div>
    </div>
  );
}
