"use client";

import { useEffect, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * A hex-only colour field: native swatch, typed hex, and one-tap presets.
 *
 * The empty string is a real value here, not "unfilled" — it means "inherit",
 * and callers that store colours in SiteConfig rely on that to keep a
 * theme-following default. `<input type="color">` has no empty state, so the
 * swatch shows `fallback` while the value is empty and the Default chip is the
 * way back to it.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface ColorPreset {
  value: string;
  label: string;
}

export function ColorField({
  label,
  hint,
  value,
  onChange,
  presets = [],
  fallback = "#FAFAFA",
  defaultLabel = "Default",
  defaultHint,
}: {
  label?: string;
  hint?: string;
  /** "" = inherit. Anything else is a hex literal. */
  value: string;
  onChange: (value: string) => void;
  presets?: ColorPreset[];
  /** Shown in the swatch while the value is empty — what "inherit" looks like. */
  fallback?: string;
  defaultLabel?: string;
  defaultHint?: string;
}) {
  // The text box holds half-typed hex ("#2", "#22c5"), which is not a value the
  // parent should ever see. It only commits on a complete match, and re-syncs
  // whenever the value moves from elsewhere (a preset, Reset, the picker).
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (next: string) => {
    const hex = next.trim();
    if (hex === "") return onChange("");
    if (HEX.test(hex)) onChange(hex.toUpperCase());
  };

  const active = value.toUpperCase();

  return (
    <div className="f">
      {label && <label>{label}</label>}

      <div className="flex items-center gap-2">
        {/* `.swatch` carries the well, the transparent picker inside it and the
            focus ring — see control-room.css. */}
        <span className="swatch" style={{ background: value || fallback }}>
          <input
            type="color"
            aria-label={label ? `${label} — colour picker` : "Colour picker"}
            value={value || fallback}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
          />
        </span>

        <input
          className="in mono"
          value={draft}
          spellCheck={false}
          placeholder={fallback}
          aria-label={label ? `${label} — hex value` : "Hex value"}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          // A draft left mid-hex on blur snaps back rather than lingering as a
          // value the field shows but has not saved.
          onBlur={() => setDraft(value)}
        />
      </div>

      {(presets.length > 0 || defaultLabel) && (
        <div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 2 }}>
          {presets.map((p) => {
            const on = active === p.value.toUpperCase();
            return (
              <button
                key={p.value}
                type="button"
                title={`${p.label} · ${p.value}`}
                aria-label={p.label}
                aria-pressed={on}
                onClick={() => onChange(p.value.toUpperCase())}
                className="relative grid flex-none place-items-center rounded-full transition-transform active:scale-90"
                style={{
                  width: 20, height: 20, background: p.value,
                  border: "1px solid var(--line)",
                  boxShadow: on ? "0 0 0 2px var(--card), 0 0 0 3.5px var(--c1)" : undefined,
                }}
              >
                {on && <IconCheck size={11} stroke={3} style={{ color: readableInk(p.value) }} />}
              </button>
            );
          })}
          <button
            type="button"
            title={defaultHint}
            aria-pressed={value === ""}
            onClick={() => onChange("")}
            className={cn("chip", value === "" && "on")}
            style={{ height: 20, cursor: "pointer" }}
          >
            {defaultLabel}
          </button>
        </div>
      )}

      {hint && <div className="f-hint">{hint}</div>}
    </div>
  );
}

/** Tick colour for a swatch — luminance, so it stays legible on both ends. */
function readableInk(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "#fff";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 150 ? "#111116" : "#fff";
}
