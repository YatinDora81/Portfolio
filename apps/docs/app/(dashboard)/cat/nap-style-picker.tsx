"use client";

import { useEffect, useRef, useState } from "react";
import { NapStage, DRAWN_STYLES, NAP_STAGE_CSS } from "@/components/cat/nap-stage";

/**
 * The six nap indicators are impossible to choose between by name — "halo" and
 * "ring" read the same in a dropdown. So each style gets a tile that draws the
 * real thing: same geometry, same countdown maths as
 * apps/web/public/oneko/oneko.js, against the same sleeping sprite.
 *
 * The geometry lives in components/cat/nap-stage.tsx (which names the lines of
 * oneko.js it mirrors); this file is only the radiogroup around it.
 */

/** One full preview cycle, in ms. The countdown *shown* still runs from the
    configured nap length — a 300s nap that took 300s to demo would never be
    watched, so the clock is time-lapsed and the tiles say so. */
const CYCLE_MS = 7000;

export function NapStylePicker({
  value,
  onChange,
  napSeconds,
  options,
  label,
  hint,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  napSeconds: number;
  options: { value: string; label: string }[];
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  const [f, setF] = useState(1);
  const [catFrame, setCatFrame] = useState(0);
  // "random" has no indicator of its own, so its tile borrows one of the six and
  // swaps on each cycle — which is exactly the behaviour it is selling.
  const [randomStyle, setRandomStyle] = useState<string>(DRAWN_STYLES[0]);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  // The blanket `.cr * { animation: none }` guard cannot touch a rAF loop, so
  // the loop has to ask for itself. Under reduced motion every tile holds the
  // frame at t=0 — a full clock and the first sleeping frame — which is still a
  // truthful drawing of each indicator, just not a moving one.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      startRef.current = 0;
    };

    const start = () => {
      const drawn = [...DRAWN_STYLES];
      let last = -1;
      const tick = (t: number) => {
        if (!startRef.current) startRef.current = t;
        const elapsed = (t - startRef.current) % CYCLE_MS;
        const cycle = Math.floor((t - startRef.current) / CYCLE_MS);
        if (cycle !== last) {
          last = cycle;
          setRandomStyle(drawn[cycle % drawn.length]!);
        }
        setF(1 - elapsed / CYCLE_MS);
        setCatFrame(Math.floor(elapsed / 500));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const sync = () => {
      stop();
      if (mq.matches) {
        setF(1);
        setCatFrame(0);
        setRandomStyle(DRAWN_STYLES[0]);
        return;
      }
      start();
    };

    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      stop();
    };
  }, []);

  const secs = `${Math.max(0, Math.ceil(f * napSeconds))}s`;

  return (
    <div className="f nsp" style={{ marginBottom: 0 }}>
      <div className="nsp-grid" role="radiogroup" aria-label={label}>
        {options.map(o => {
          // The stored labels read "Ticks — watch-face dial around the cat".
          const [name, ...rest] = o.label.split("—");
          const desc = rest.join("—").trim();
          const selected = o.value === value;
          const drawn = o.value === "random" ? randomStyle : o.value;
          return (
            <button
              type="button"
              key={o.value}
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={`nsp-tile${selected ? " is-on" : ""}`}
              onClick={() => onChange(o.value)}
            >
              <NapStage style={drawn} f={f} secs={secs} catFrame={catFrame} />
              <span className="nsp-meta">
                <span className="nsp-name">
                  {name!.trim()}
                  {o.value === "random" && <em className="nsp-now">{randomStyle}</em>}
                  {selected && <i className="nsp-live" aria-hidden />}
                </span>
                <span className="nsp-desc">{desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="f-hint" style={{ marginTop: 10 }}>
        {hint}
        <span className="nsp-hint-sep">·</span>
        Time-lapsed: each clock counts {napSeconds}s down over {CYCLE_MS / 1000}s.
      </div>
      <style>{NAP_STAGE_CSS}{PICKER_CSS}</style>
    </div>
  );
}

/**
 * Scoped to `.nsp`, painted entirely in control-room tokens. Focus is the
 * global `.cr :focus-visible` rule — deliberately not redeclared here.
 */
const PICKER_CSS = `
.nsp .nsp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:9px}
.nsp .nsp-tile{display:flex;flex-direction:column;gap:0;padding:0;text-align:left;cursor:pointer;background:var(--card);border:1px solid var(--line2);border-radius:var(--r2);overflow:hidden;transition:border-color .18s,box-shadow .18s,transform .18s;font:inherit;color:inherit}
.nsp .nsp-tile:hover{border-color:var(--line);transform:translateY(-1px)}
.nsp .nsp-tile.is-on{border-color:var(--c1);box-shadow:0 0 0 1px var(--c1) inset}
.nsp .nsp-tile:disabled{cursor:default;opacity:.5;transform:none}

.nsp .nsp-meta{display:flex;flex-direction:column;gap:3px;padding:9px 11px 10px}
.nsp .nsp-name{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ink)}
.nsp .nsp-tile.is-on .nsp-name{color:var(--accT)}
.nsp .nsp-now{font-family:var(--mono);font-size:10px;font-weight:500;font-style:normal;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:1px 6px}
/* the selected tile is the one the site is serving — a live dot says so without
   a second colour or a badge that would crowd a 200px tile */
.nsp .nsp-live{width:6px;height:6px;border-radius:99px;background:var(--c1);margin-left:auto;flex:none}
.nsp .nsp-desc{font-size:11px;line-height:1.4;color:var(--dim)}
.nsp .nsp-hint-sep{margin:0 6px;opacity:.5}
`;
