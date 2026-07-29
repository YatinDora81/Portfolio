"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The six nap indicators are impossible to choose between by name — "halo" and
 * "ring" read the same in a dropdown. So each style gets a tile that draws the
 * real thing: same geometry, same colours, same countdown maths as
 * apps/web/public/oneko/oneko.js, against the same sleeping sprite.
 *
 * The drawing here is a deliberate second copy of that script's markup rather
 * than a shared module: the script is a standalone IIFE served as a static
 * asset to the *public* app, with no build step and no export, and the admin
 * cannot import from it. Anything that changes an indicator's geometry has to
 * be changed in both places — the per-indicator comments below name the lines
 * in oneko.js each tile mirrors.
 */

/** oneko.js `spriteSets.sleeping` — two frames, in 32px sprite-sheet cells. */
const SLEEP_FRAMES = [
  [-2, 0],
  [-2, -1],
] as const;

/** oneko.js: `RING_C`, the r=30 circumference the arc's dash is cut from. */
const RING_C = 188.5;

/** One full preview cycle, in ms. The countdown *shown* still runs from the
    configured nap length — a 300s nap that took 300s to demo would never be
    watched, so the clock is time-lapsed and the tiles say so. */
const CYCLE_MS = 7000;

/** Styles that draw something. "random" and "off" are choices, not indicators. */
const DRAWN = new Set(["ticks", "moon", "pixel", "halo", "ring", "tooltip"]);

function CatSprite({ frame }: { frame: number }) {
  const [x, y] = SLEEP_FRAMES[frame % SLEEP_FRAMES.length]!;
  return (
    <i
      className="nsp-cat"
      style={{ backgroundPosition: `${x * 32}px ${y * 32}px` }}
      aria-hidden
    />
  );
}

/** oneko.js `#nk-ticks`: 30 lines from r38 to r44 about (48,48), first at -90°.
    `tOn = Math.ceil(f * 30)` lines stay lit; the rest drop to .14 opacity. */
function Ticks({ f }: { f: number }) {
  const on = Math.ceil(f * 30);
  return (
    <svg className="nsp-ticks" width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      {Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2 - Math.PI / 2;
        return (
          <line
            key={i}
            x1={(48 + Math.cos(a) * 38).toFixed(1)}
            y1={(48 + Math.sin(a) * 38).toFixed(1)}
            x2={(48 + Math.cos(a) * 44).toFixed(1)}
            y2={(48 + Math.sin(a) * 44).toFixed(1)}
            style={{ opacity: i < on ? 1 : 0.14 }}
          />
        );
      })}
    </svg>
  );
}

/** oneko.js `#nk-ring`: r=30 track plus an arc whose dashoffset is C*(1-f). */
function Ring({ f, secs }: { f: number; secs: string }) {
  return (
    <span className="nsp-ring">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle className="nsp-ring-track" cx="42" cy="42" r="30" fill="none" strokeWidth="2.5" />
        <circle
          className="nsp-ring-arc"
          cx="42"
          cy="42"
          r="30"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={(RING_C * (1 - f)).toFixed(1)}
          transform="rotate(-90 42 42)"
        />
      </svg>
      <b className="nsp-ring-secs">{secs}</b>
    </span>
  );
}

/** oneko.js `#nk-moon`: the moon rides a dashed arc, `ma = (1 - f) * PI`. The
    crescent is a cutout circle painted the stage's own background, so the tile
    hands it `--nsp-stage` the same way the site hands it the page background. */
function Moon({ f }: { f: number }) {
  const ma = (1 - f) * Math.PI;
  const tx = (64 - Math.cos(ma) * 50).toFixed(1);
  const ty = (66 - Math.sin(ma) * 50).toFixed(1);
  return (
    <span className="nsp-moon">
      <svg width="128" height="76" viewBox="0 0 128 76" aria-hidden>
        <path className="nsp-moon-arc" d="M 14 66 A 50 50 0 0 1 114 66" fill="none" strokeWidth="1" strokeDasharray="2 5" />
        <circle className="nsp-star" cx="36" cy="28" r="1.3" />
        <circle className="nsp-star s2" cx="64" cy="13" r="1.6" />
        <circle className="nsp-star s3" cx="94" cy="30" r="1.2" />
        <g transform={`translate(${tx},${ty})`}>
          <circle className="nsp-moon-body" r="7" />
          <circle className="nsp-moon-cut" r="7" cx="4.5" cy="-3" />
        </g>
      </svg>
    </span>
  );
}

/** oneko.js `#nk-px`: ten blocks, `on = Math.round(f * 10)` of them lit. */
function Pixel({ f }: { f: number }) {
  const on = Math.round(f * 10);
  return (
    <span className="nsp-px">
      <span className="nsp-px-z">Zz</span>
      <span className="nsp-px-bar">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < on ? "on" : undefined} />
        ))}
      </span>
      <span className="nsp-px-tail1" />
      <span className="nsp-px-tail2" />
    </span>
  );
}

/** oneko.js `#cat-bubble`: a pill whose conic-gradient border drains with f. */
function Tooltip({ f, secs }: { f: number; secs: string }) {
  return (
    <span className="nsp-bubble" style={{ ["--nb-p" as string]: `${(f * 100).toFixed(1)}%` }}>
      <span className="nsp-bubble-count">{secs}</span>
    </span>
  );
}

/** oneko.js `#nk-halo`: no clock at all — a breathing glow that fades with f. */
function Halo({ f }: { f: number }) {
  return (
    <span className="nsp-halo" style={{ opacity: (0.35 + 0.65 * f).toFixed(2) }}>
      <b />
    </span>
  );
}

function Stage({ style, f, secs, catFrame }: { style: string; f: number; secs: string; catFrame: number }) {
  if (style === "off") {
    return (
      <div className="nsp-stage nsp-stage-off">
        <CatSprite frame={0} />
        <span className="nsp-off-note">never sleeps</span>
      </div>
    );
  }
  return (
    <div className="nsp-stage">
      {style === "halo" && <Halo f={f} />}
      {style === "ticks" && <Ticks f={f} />}
      {style === "ring" && <Ring f={f} secs={secs} />}
      {style === "moon" && <Moon f={f} />}
      {style === "pixel" && <Pixel f={f} />}
      {style === "tooltip" && <Tooltip f={f} secs={secs} />}
      <CatSprite frame={catFrame} />
    </div>
  );
}

export function NapStylePicker({
  value,
  onChange,
  napSeconds,
  options,
  label,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  napSeconds: number;
  options: { value: string; label: string }[];
  label: string;
  hint: string;
}) {
  const [f, setF] = useState(1);
  const [catFrame, setCatFrame] = useState(0);
  // "random" has no indicator of its own, so its tile borrows one of the six and
  // swaps on each cycle — which is exactly the behaviour it is selling.
  const [randomStyle, setRandomStyle] = useState("ticks");
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const drawn = [...DRAWN];
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
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const secs = `${Math.max(0, Math.ceil(f * napSeconds))}s`;

  return (
    <div className="f nsp" style={{ gridColumn: "1 / -1" }}>
      <label>{label}</label>
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
              className={`nsp-tile${selected ? " is-on" : ""}`}
              onClick={() => onChange(o.value)}
            >
              <Stage style={drawn} f={f} secs={secs} catFrame={catFrame} />
              <span className="nsp-meta">
                <span className="nsp-name">
                  {name!.trim()}
                  {o.value === "random" && <em className="nsp-now">{randomStyle}</em>}
                </span>
                <span className="nsp-desc">{desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="f-hint">
        {hint}
        <span className="nsp-hint-sep">·</span>
        Previews run time-lapsed: the clock counts {napSeconds}s down over {CYCLE_MS / 1000}s.
      </div>
      <style>{CSS}</style>
    </div>
  );
}

/**
 * Scoped to `.nsp`. The indicators in oneko.js are drawn for a dark page and
 * inverted there under `html:not(.dark)`; the same inversions are repeated here
 * against the admin's own `.dark` class, which its theme-provider sets.
 */
const CSS = `
.nsp .nsp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px;margin-top:2px}
.nsp-tile{display:flex;flex-direction:column;gap:0;padding:0;text-align:left;cursor:pointer;background:var(--card,#fff);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:border-color .18s,box-shadow .18s,transform .18s;font:inherit;color:inherit}
.nsp-tile:hover{border-color:var(--muted-fg,#888);transform:translateY(-1px)}
.nsp-tile:focus-visible{outline:2px solid var(--accent,#34d399);outline-offset:2px}
.nsp-tile.is-on{border-color:var(--accent,#34d399);box-shadow:0 0 0 1px var(--accent,#34d399) inset}

/* --nsp-stage is read by the moon's crescent cutout, which fakes the shadow by
   painting a second disc the stage's own colour. It must stay a solid colour. */
.nsp .nsp-stage{--nsp-stage:#0a0a0a;position:relative;height:132px;background:var(--nsp-stage);display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;overflow:hidden;border-bottom:1px solid var(--border)}
.nsp .nsp-cat{position:relative;z-index:2;width:32px;height:32px;background-image:url(/oneko/oneko.gif);image-rendering:pixelated;flex:0 0 auto}
.nsp .nsp-stage-off .nsp-cat{opacity:.75}
.nsp .nsp-off-note{position:absolute;top:50%;left:0;right:0;text-align:center;transform:translateY(-50%);font:500 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#52525b}

.nsp .nsp-meta{display:flex;flex-direction:column;gap:2px;padding:8px 10px 9px}
.nsp .nsp-name{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--fg)}
.nsp .nsp-now{font:500 10px ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#34d399;border:1px solid rgba(52,211,153,.32);border-radius:999px;padding:1px 5px}
.nsp .nsp-desc{font-size:11px;line-height:1.35;color:var(--muted-fg,#8b8b8b)}
.nsp .nsp-hint-sep{margin:0 6px;opacity:.5}

/* ticks — oneko.js #nk-ticks */
.nsp .nsp-ticks{position:absolute;left:50%;bottom:14px;width:96px;height:96px;margin-left:-48px;margin-bottom:-32px;z-index:1}
.nsp .nsp-ticks line{stroke:#34d399;stroke-width:2;stroke-linecap:round;transition:opacity .3s}

/* ring — oneko.js #nk-ring */
.nsp .nsp-ring{position:absolute;left:50%;bottom:14px;width:84px;height:84px;margin-left:-42px;margin-bottom:-26px;z-index:1}
.nsp .nsp-ring-track{stroke:rgba(255,255,255,.18)}
.nsp .nsp-ring-arc{stroke:#34d399;transition:stroke-dashoffset .15s linear}
.nsp .nsp-ring-secs{position:absolute;top:calc(100% - 10px);left:50%;transform:translateX(-50%);font:500 11px system-ui,-apple-system,sans-serif;color:#a3a3a3;font-variant-numeric:tabular-nums}

/* halo — oneko.js #nk-halo */
.nsp .nsp-halo{position:absolute;left:50%;bottom:30px;width:0;height:0;z-index:1;transition:opacity .3s}
.nsp .nsp-halo b{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:radial-gradient(circle,rgba(52,211,153,.30),rgba(52,211,153,0) 68%);animation:nsp-breath 3s ease-in-out infinite}

/* moon — oneko.js #nk-moon */
.nsp .nsp-moon{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:1;line-height:0}
.nsp .nsp-moon-arc{stroke:rgba(255,255,255,.15)}
.nsp .nsp-star{fill:rgba(255,255,255,.75);animation:nsp-twinkle 2.2s ease-in-out infinite}
.nsp .nsp-star.s2{animation-delay:.7s}
.nsp .nsp-star.s3{animation-delay:1.3s}
.nsp .nsp-moon-body{fill:#e5e5eb}
.nsp .nsp-moon-cut{fill:var(--nsp-stage)}

/* pixel — oneko.js #nk-px */
.nsp .nsp-px{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);z-index:1;display:flex;align-items:center;gap:7px;background:#18181b;border:2px solid #52525b;padding:5px 8px;white-space:nowrap}
.nsp .nsp-px-tail1{position:absolute;bottom:-8px;left:50%;margin-left:-10px;width:6px;height:6px;background:#52525b}
.nsp .nsp-px-tail2{position:absolute;bottom:-14px;left:50%;margin-left:-4px;width:4px;height:4px;background:#52525b}
.nsp .nsp-px-z{font:500 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#34d399}
.nsp .nsp-px-bar{display:flex;gap:2px}
.nsp .nsp-px-bar span{width:5px;height:9px;background:#3f3f46}
.nsp .nsp-px-bar span.on{background:#34d399}

/* tooltip — oneko.js #cat-bubble */
.nsp .nsp-bubble{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:1;display:flex;align-items:center;background:rgba(23,23,23,.86);border-radius:999px;padding:2px 8px 3px;white-space:nowrap}
.nsp .nsp-bubble::before{content:'';position:absolute;inset:0;border-radius:999px;padding:1.25px;background:conic-gradient(from 0deg,#34d399 var(--nb-p,100%),rgba(255,255,255,.10) 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none}
.nsp .nsp-bubble-count{font:500 11px/1.2 system-ui,-apple-system,sans-serif;color:#f4f4f5;font-variant-numeric:tabular-nums}

/* The light theme repeats oneko.js's html:not(.dark) block: the stage turns
   pale, so white strokes and the background-coloured crescent both invert. */
html:not(.dark) .nsp .nsp-stage{--nsp-stage:#fafafa}
html:not(.dark) .nsp .nsp-ring-track{stroke:rgba(17,17,22,.16)}
html:not(.dark) .nsp .nsp-ring-arc,html:not(.dark) .nsp .nsp-ticks line{stroke:#059669}
html:not(.dark) .nsp .nsp-moon-arc{stroke:rgba(17,17,22,.16)}
html:not(.dark) .nsp .nsp-star{fill:rgba(17,17,22,.5)}
html:not(.dark) .nsp .nsp-moon-body{fill:#3f3f46}
html:not(.dark) .nsp .nsp-moon-cut{fill:#fff}
html:not(.dark) .nsp .nsp-ring-secs{color:#52525b}
html:not(.dark) .nsp .nsp-px-z,html:not(.dark) .nsp .nsp-px-bar span.on{color:#059669}
html:not(.dark) .nsp .nsp-px-bar span.on{background:#059669}
html:not(.dark) .nsp .nsp-halo b{background:radial-gradient(circle,rgba(5,150,105,.28),rgba(5,150,105,0) 68%)}

@keyframes nsp-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
@keyframes nsp-twinkle{0%,100%{opacity:.25}50%{opacity:.9}}

@media (prefers-reduced-motion:reduce){
  .nsp .nsp-halo b,.nsp .nsp-star{animation:none}
  .nsp .nsp-ticks line,.nsp .nsp-ring-arc{transition:none}
}
`;
