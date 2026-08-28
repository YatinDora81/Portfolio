"use client";

const SLEEP_FRAMES = [
  [-2, 0],
  [-2, -1],
] as const;

const IDLE_FRAME = [-3, -3] as const;

// r=30 circumference the arc's dash is cut from
const RING_C = 188.5;

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

function Tooltip({ f, secs }: { f: number; secs: string }) {
  return (
    <span className="nsp-bubble" style={{ ["--nb-p" as string]: `${(f * 100).toFixed(1)}%` }}>
      <span className="nsp-bubble-count">{secs}</span>
    </span>
  );
}

function Halo({ f }: { f: number }) {
  return (
    <span className="nsp-halo" style={{ opacity: (0.35 + 0.65 * f).toFixed(2) }}>
      <b />
    </span>
  );
}

// f: 1 = just dropped, 0 = about to wake
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

export const NAP_STAGE_CSS = `
.nsp{
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
.nsp .nsp-stage-bare{background:none;border-bottom:none;height:auto;overflow:visible}
.nsp .nsp-cat{position:relative;z-index:2;width:32px;height:32px;background-image:url(/oneko/oneko.gif);image-rendering:pixelated;flex:0 0 auto}
.nsp .nsp-stage-off .nsp-cat{opacity:.8}
.nsp .nsp-off-note{position:absolute;top:50%;left:0;right:0;text-align:center;transform:translateY(-50%);font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}

/* ticks: oneko #nk-ticks */
.nsp .nsp-ticks{position:absolute;left:50%;bottom:14px;width:96px;height:96px;margin-left:-48px;margin-bottom:-32px;z-index:1}
.nsp .nsp-ticks line{stroke:var(--nsp-ink);stroke-width:2;stroke-linecap:round;transition:opacity .3s}

/* ring: oneko #nk-ring */
.nsp .nsp-ring{position:absolute;left:50%;bottom:14px;width:84px;height:84px;margin-left:-42px;margin-bottom:-26px;z-index:1}
.nsp .nsp-ring-track{stroke:var(--nsp-track)}
.nsp .nsp-ring-arc{stroke:var(--nsp-ink);transition:stroke-dashoffset .15s linear}
.nsp .nsp-ring-secs{position:absolute;top:calc(100% - 10px);left:50%;transform:translateX(-50%);font-family:var(--ui);font-size:11px;font-weight:500;color:var(--nsp-meta);font-variant-numeric:tabular-nums}

/* halo: oneko #nk-halo */
.nsp .nsp-halo{position:absolute;left:50%;bottom:30px;width:0;height:0;z-index:1;transition:opacity .3s}
.nsp .nsp-halo b{position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--nsp-ink) 30%,transparent),transparent 68%);animation:nsp-breath 3s ease-in-out infinite}

/* moon: oneko #nk-moon */
.nsp .nsp-moon{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:1;line-height:0}
.nsp .nsp-moon-arc{stroke:var(--nsp-track)}
.nsp .nsp-star{fill:var(--nsp-meta);animation:nsp-twinkle 2.2s ease-in-out infinite}
.nsp .nsp-star.s2{animation-delay:.7s}
.nsp .nsp-star.s3{animation-delay:1.3s}
.nsp .nsp-moon-body{fill:var(--nsp-face)}
.nsp .nsp-moon-cut{fill:var(--nsp-stage)}

/* pixel: oneko #nk-px */
.nsp .nsp-px{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);z-index:1;display:flex;align-items:center;gap:7px;background:var(--nsp-panel);border:2px solid var(--nsp-edge);padding:5px 8px;white-space:nowrap}
.nsp .nsp-px-tail1{position:absolute;bottom:-8px;left:50%;margin-left:-10px;width:6px;height:6px;background:var(--nsp-edge)}
.nsp .nsp-px-tail2{position:absolute;bottom:-14px;left:50%;margin-left:-4px;width:4px;height:4px;background:var(--nsp-edge)}
.nsp .nsp-px-z{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--nsp-ink)}
.nsp .nsp-px-bar{display:flex;gap:2px}
.nsp .nsp-px-bar span{width:5px;height:9px;background:var(--nsp-off)}
.nsp .nsp-px-bar span.on{background:var(--nsp-ink)}

/* tooltip: oneko #cat-bubble */
.nsp .nsp-bubble{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);z-index:1;display:flex;align-items:center;background:var(--nsp-panel);border-radius:999px;padding:2px 8px 3px;white-space:nowrap}
.nsp .nsp-bubble::before{content:'';position:absolute;inset:0;border-radius:999px;padding:1.25px;background:conic-gradient(from 0deg,var(--nsp-ink) var(--nb-p,100%),var(--nsp-track) 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none}
.nsp .nsp-bubble-count{font-family:var(--ui);font-size:11px;line-height:1.2;font-weight:500;color:var(--nsp-face);font-variant-numeric:tabular-nums}

@keyframes nsp-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
@keyframes nsp-twinkle{0%,100%{opacity:.25}50%{opacity:.9}}

@media (prefers-reduced-motion:reduce){
  .nsp .nsp-halo b,.nsp .nsp-star{animation:none}
  .nsp .nsp-ticks line,.nsp .nsp-ring-arc{transition:none}
}
`;
