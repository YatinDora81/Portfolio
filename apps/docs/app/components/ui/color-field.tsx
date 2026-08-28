"use client";

import { useEffect, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

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
  fallback?: string;
  defaultLabel?: string;
  defaultHint?: string;
}) {
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

function readableInk(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "#fff";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 150 ? "#111116" : "#fff";
}
