"use client";

/**
 * The napping cat, drawn — sprite, stage and all six nap indicators.
 *
 * PAIRED FILE: apps/web/public/oneko/oneko.js. The drawing here is a deliberate
 * second copy of that script's markup rather than a shared module: the script is
 * a standalone IIFE served as a static asset to the *public* app, with no build
 * step and no export, and the admin cannot import from it. Anything that changes
 * an indicator's geometry has to change in both places — the per-indicator
 * comments below name the lines in oneko.js each one mirrors.
 *
 * There is exactly ONE copy inside the admin: the nap picker on /cat and the
 * /cat preview pane both render `NapStage`, so a geometry fix lands in both.
 *
 * Colour is parameterised, not hardcoded. Inside the control room every one of
 * these resolves through a theme token; the preview pane overrides the same
 * seven with oneko.js's own literals, because that pane mimics the public site
 * and must not drift with the admin theme.
 *   --nsp-ink    the indicator colour        (token: --good)
 *   --nsp-stage  the stage fill              (token: --well / --bg1)
 *   --nsp-track  ring track, moon arc        (token: --line)
 *   --nsp-face   moon disc, bubble numerals  (token: --ink)
 *   --nsp-panel  pixel + tooltip bubble fill (token: --card)
 *   --nsp-edge   pixel bubble border + tail  (token: --line)
 *   --nsp-off    unlit pixel blocks          (token: --bg4)
 *   --nsp-meta   seconds line, stars         (token: --dim)
 *
 * `--nsp-stage` MUST stay a solid colour — the moon's crescent is faked by
 * painting a second disc in exactly this colour, the same trick oneko.js plays
 * with the page background.
 */

/** oneko.js `spriteSets.sleeping` — two frames, in 32px sprite-sheet cells. */
const SLEEP_FRAMES = [
  [-2, 0],
  [-2, -1],
] as const;

/** oneko.js `spriteSets.idle` — the awake, sitting frame ("never sleeps"). */
const IDLE_FRAME = [-3, -3] as const;

/** oneko.js: `RING_C`, the r=30 circumference the arc's dash is cut from. */
const RING_C = 188.5;

/** Styles that draw something. "random" and "off" are choices, not indicators. */
export const DRAWN_STYLES = ["ticks", "moon", "pixel", "halo", "ring", "tooltip"] as const;

export function CatSprite({ frame, asleep = true }: { frame: number; asleep?: boolean }) {
  const [x, y] = asleep ? SLEEP_FRAMES[frame % SLEEP_FRAMES.length]! : IDLE_FRAME;
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

/**
 * One nap, frozen at fraction `f` of its remaining time (1 = just dropped,
 * 0 = about to wake). `bare` drops the stage's own fill and keyline so the
 * preview pane can put the cat straight onto the site's background.
 */
export function NapStage({
  style,
  f,
  secs,
  catFrame,
  bare,
}: {
  style: string;
  f: number;
  secs: string;
  catFrame: number;
  bare?: boolean;
}) {
  const cls = `nsp-stage${bare ? " nsp-stage-bare" : ""}`;
  if (style === "off") {
    return (
      <div className={`${cls} nsp-stage-off`}>
        <CatSprite frame={0} asleep={false} />
        <span className="nsp-off-note">never sleeps</span>
      </div>
    );
  }
  return (
    <div className={cls}>
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

/**
 * Scoped to `.nsp`, and rendered by whichever surface is drawing a stage — the
 * picker on /cat and the /cat preview pane each emit it, which is harmless
 * (identical rules) and keeps either one usable on its own.
 *
 * oneko.js draws its indicators for a dark page and inverts them under
 * `html:not(.dark)`. Nothing is inverted here: every colour resolves through a
 * control-room token that already flips with the theme, so the admin's three
 * themes are covered by the tokens rather than by a second stylesheet.
 */
export const NAP_STAGE_CSS = `
.nsp{
  /* --well only exists on the two dark themes; light mode falls through to
     --bg1, which is the one solid tint in that palette (the dark --bg1 is
     translucent, which the moon's crescent cutout could not paint over). */
  --nsp-ink:var(--good);
  --nsp-stage:var(--well,var(--bg1));
  --nsp-track:var(--line);
  --nsp-face:var(--ink);
  --nsp-panel:var(--card);
  --nsp-edge:var(--line);
  --nsp-off:var(--bg4);
  --nsp-meta:var(--dim);
}
.nsp .nsp-stage{position:relative;height:132px;background:var(--nsp-stage);display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;overflow:hidden;border-bottom:1px solid var(--line2)}
/* keeps the 14px floor: every indicator is positioned off the stage's bottom
   edge, so dropping that padding would shift them 14px against the cat. */
.nsp .nsp-stage-bare{background:none;border-bottom:none;height:auto;overflow:visible}
.nsp .nsp-cat{position:relative;z-index:2;width:32px;height:32px;background-image:url(/oneko/oneko.gif);image-rendering:pixelated;flex:0 0 auto}
.nsp .nsp-stage-off .nsp-cat{opacity:.8}
.nsp .nsp-off-note{position:absolute;top:50%;left:0;right:0;text-align:center;transform:translateY(-50%);font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}

/* ticks — oneko.js #nk-ticks */
.nsp .nsp-ticks{position:absolute;left:50%;bottom:14px;width:96px;height:96px;margin-left:-48px;margin-bottom:-32px;z-index:1}
.nsp .nsp-ticks line{stroke:var(--nsp-ink);stroke-width:2;stroke-linecap:round;transition:opacity .3s}

/* ring — oneko.js #nk-ring */
.nsp .nsp-ring{position:absolute;left:50%;bottom:14px;width:84px;height:84px;margin-left:-42px;margin-bottom:-26px;z-index:1}
.nsp .nsp-ring-track{stroke:var(--nsp-track)}
.nsp .nsp-ring-arc{stroke:var(--nsp-ink);transition:stroke-dashoffset .15s linear}
.nsp .nsp-ring-secs{position:absolute;top:calc(100% - 10px);left:50%;transform:translateX(-50%);font-family:var(--ui);font-size:11px;font-weight:500;color:var(--nsp-meta);font-variant-numeric:tabular-nums}

/* halo — oneko.js #nk-halo */
.nsp .nsp-halo{position:absolute;left:50%;bottom:30px;width:0;height:0;z-index:1;transition:opacity .3s}
.nsp .nsp-halo b{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--nsp-ink) 30%,transparent),transparent 68%);animation:nsp-breath 3s ease-in-out infinite}

/* moon — oneko.js #nk-moon */
.nsp .nsp-moon{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:1;line-height:0}
.nsp .nsp-moon-arc{stroke:var(--nsp-track)}
.nsp .nsp-star{fill:var(--nsp-meta);animation:nsp-twinkle 2.2s ease-in-out infinite}
.nsp .nsp-star.s2{animation-delay:.7s}
.nsp .nsp-star.s3{animation-delay:1.3s}
.nsp .nsp-moon-body{fill:var(--nsp-face)}
.nsp .nsp-moon-cut{fill:var(--nsp-stage)}

/* pixel — oneko.js #nk-px */
.nsp .nsp-px{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);z-index:1;display:flex;align-items:center;gap:7px;background:var(--nsp-panel);border:2px solid var(--nsp-edge);padding:5px 8px;white-space:nowrap}
.nsp .nsp-px-tail1{position:absolute;bottom:-8px;left:50%;margin-left:-10px;width:6px;height:6px;background:var(--nsp-edge)}
.nsp .nsp-px-tail2{position:absolute;bottom:-14px;left:50%;margin-left:-4px;width:4px;height:4px;background:var(--nsp-edge)}
.nsp .nsp-px-z{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--nsp-ink)}
.nsp .nsp-px-bar{display:flex;gap:2px}
.nsp .nsp-px-bar span{width:5px;height:9px;background:var(--nsp-off)}
.nsp .nsp-px-bar span.on{background:var(--nsp-ink)}

/* tooltip — oneko.js #cat-bubble */
.nsp .nsp-bubble{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:1;display:flex;align-items:center;background:var(--nsp-panel);border-radius:999px;padding:2px 8px 3px;white-space:nowrap}
.nsp .nsp-bubble::before{content:'';position:absolute;inset:0;border-radius:999px;padding:1.25px;background:conic-gradient(from 0deg,var(--nsp-ink) var(--nb-p,100%),var(--nsp-track) 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none}
.nsp .nsp-bubble-count{font-family:var(--ui);font-size:11px;line-height:1.2;font-weight:500;color:var(--nsp-face);font-variant-numeric:tabular-nums}

@keyframes nsp-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
@keyframes nsp-twinkle{0%,100%{opacity:.25}50%{opacity:.9}}

/* The global \`.cr *\` kill switch already covers these; repeated because the
   preview pane's stage can be portalled outside \`.cr\` in future. */
@media (prefers-reduced-motion:reduce){
  .nsp .nsp-halo b,.nsp .nsp-star{animation:none}
  .nsp .nsp-ticks line,.nsp .nsp-ring-arc{transition:none}
}
`;
