"use client";

import { useEffect } from "react";
import { ConfigCard, type ConfigGroup, type ControlContext } from "@/components/config/config-card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { NUMBER_RANGE, clampNumber, type BackgroundVersion } from "@/lib/site-config-keys";
import { IconAlertTriangle } from "@tabler/icons-react";

/**
 * The eight rows the contour map is drawn with.
 *
 * Every one of them is a number the engine reads inside a per-frame loop, which
 * is why they are sliders and not boxes: the useful question here is never "is
 * 34 right", it is "which way from 34", and that is a question you answer by
 * dragging while the pane redraws. The typed field would answer it one guess at
 * a time.
 *
 * It posts only these eight. The layer tile above is a separate card and a
 * separate save, so tuning the map can never flip the site back to the lines —
 * and, for exactly the same reason, saving here can never turn the map on. Two
 * payloads is the safe arrangement and the confusing one, so wherever the tile
 * and the row disagree the card says so in a band against its own footer, where
 * the button that would publish the half is.
 */

/** The unit each dial is read in — the readout is meaningless without it, and
    the percent rows are stored as plain integers so a row stays human. */
const DIALS: { key: string; unit: string }[] = [
  { key: "terrainStrength", unit: "%" },
  { key: "terrainVeil", unit: "%" },
  { key: "terrainCell", unit: "px" },
  { key: "terrainLevels", unit: "" },
  { key: "terrainMinor", unit: "%" },
  { key: "terrainMajor", unit: "%" },
];

/** What the switch says it is doing, per key. Deliberately not ConfigCard's
    native toggle: that one is captioned "Pulsing / Still" for the hero's status
    dot, which says nothing true about a reading channel. */
const FLAGS: Record<string, { on: string; off: string }> = {
  terrainChannel: { on: "Erased", off: "Drawn through" },
  terrainInteractive: { on: "Follows the pointer", off: "Still" },
};

export function BackgroundTerrainCard({ values, saved, picked, onDraftChange }: {
  /** The eight rows as the database holds them, already defaulted by the page. */
  values: Record<string, string>;
  /** What `backgroundVersion` holds right now — what visitors are getting. */
  saved: BackgroundVersion;
  /** The tile picked above, saved or not. */
  picked: BackgroundVersion;
  /** The live draft, so the pane moves as a slider is dragged. */
  onDraftChange: (values: Record<string, string>) => void;
}) {
  // Dead only when the terrain is neither what the site is serving nor what the
  // tile above is about to make it. A pick of v1 over a live v2 leaves these
  // editable on purpose: they are still the map visitors have in front of them
  // until that pick is saved.
  const dead = saved === "v1" && picked === "v1";
  const leaving = saved === "v2" && picked === "v1";
  // The first-use path, and the one that used to say nothing: the tile has been
  // moved to the terrain but not saved, so every dial below is being tuned for a
  // layer no visitor is on yet.
  const arriving = saved === "v1" && picked === "v2";

  const blurb = dead
    ? "The lines are the live layer and the tile above still says so, so nothing on this card reaches anyone — these eight rows save fine and are read by nothing. Pick the terrain above to wake them up."
    : leaving
      ? "The terrain is what visitors have now, but the tile above is set to the lines — saving that pick retires every value here without changing one of them."
      : arriving
        ? "The tile above is set to the terrain, but that pick is not saved, so the lines are still what visitors are on and these eight are still read by nobody. Strength multiplies the minor and major lines together, so it is the one to move before either of them."
        : "Six dials for the map and two for what it does while someone is reading over it. Strength multiplies the minor and major lines together, so it is the one to move before either of them.";

  // The tile is a draft; the row it is drafting is not this card's to post. So
  // whenever the two disagree, this card's own Save & Publish sends the site
  // live on the layer it was already on — a true statement that has to be made
  // next to the button, not at the top of the card the owner stopped reading
  // six sliders ago.
  //
  // `.cfg-err` rather than a class of its own: it is the config family's amber
  // advisory band and this is the same weight of thing. ConfigCard already draws
  // the keyline above a `slot`, so the class's own top border comes back off.
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

/**
 * `ControlContext` carries no key, so the range needs its own — the min and max
 * come from the same NUMBER_RANGE the action clamps to, and the field is not
 * allowed to offer a value that gets rewritten on the way in.
 */
function Dial({ ctx, name, unit }: { ctx: ControlContext; name: string; unit: string }) {
  const range = NUMBER_RANGE[name];
  const { set, value, disabled } = ctx;
  // The slider cannot hold an out-of-range value the way the number box could,
  // so a row edited around the admin snaps to the nearest legal one on sight.
  const n = clampNumber(name, value);

  // ...and the snap has to reach the draft, not just the thumb. The number box
  // writes its clamp back on blur; a range input has no typed value to blur, so
  // without this a row holding 5 sits under a thumb at 10 and — being unchanged
  // — leaves the card with nothing to save and no unsaved marker. Skipped while
  // the dial is dead: a card the blurb just called inert has no business
  // announcing an unsaved field.
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
        {/* The range input already announces its own value, so the readout is
            for the eye only and stays out of the accessibility tree. */}
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
  // Absent row = on, matching what apps/web falls back to, so an untouched
  // database and a switch left alone say the same thing.
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
