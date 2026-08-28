"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createTerrain, type TerrainHandle } from "@repo/ui/terrain";
import { DIM, FAINT, MONO } from "./frame";

const INK: [number, number, number] = [250, 250, 250];
const GROUND = "#0a0a0a";

const WIRE = "rgba(255,255,255,0.1)";

const V1_VEIL = 0.5;

const SCENE_W = 1280;

const NARROW = 520;

const STAGE_H = 360;

const CH_INNER = 360;
const CH_OUTER = 450;

const AA = 4.5;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const GROUND_RGB = rgb(GROUND);

const TEXT = rgb(DIM);

const SETTLE = 2600;

const METER_MS = 1200;

function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function mix(
  p: [number, number, number],
  q: [number, number, number],
  t: number
): [number, number, number] {
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
}

export function BackgroundPreview({
  version,
  strength,
  veil,
  cell,
  levels,
  minor,
  major,
  channel,
  interactive,
}: {
  version: "v1" | "v2";
  strength: number;
  veil: number;
  cell: number;
  levels: number;
  minor: number;
  major: number;
  channel: boolean;
  interactive: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = box.w > 0 && box.w < NARROW;
  const sceneW = box.w === 0 ? 0 : narrow ? box.w : SCENE_W;
  const scale = sceneW > 0 ? box.w / sceneW : 1;
  const sceneH = scale > 0 ? Math.round(box.h / scale) : 0;
  const ready = sceneW > 0 && sceneH > 0;

  const terrain = version === "v2";
  const drawsTerrain = terrain && !narrow;
  const live = drawsTerrain && interactive && !reduced;
  const veilAlpha = terrain ? veil : V1_VEIL;

  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const hotRef = useRef(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const touch = useCallback(() => { hotRef.current = performance.now(); }, []);

  useEffect(() => { hotRef.current = performance.now(); }, [
    version, strength, veil, cell, levels, minor, major, channel, interactive, reduced, box.w, box.h,
  ]);

  useEffect(() => {
    if (!drawsTerrain || !ready) { setRatio(null); return; }

    const read = () => {
      const canvas = canvasRef.current;
      if (!canvas?.width || !canvas.height) return;

      const dpr = canvas.width / sceneW;
      const x0 = Math.max(0, Math.round((sceneW / 2 - CH_INNER) * dpr));
      const cw = Math.min(canvas.width, Math.round(2 * CH_INNER * dpr));

      const scratch = (scratchRef.current ??= document.createElement("canvas"));
      scratch.width = cw; // assigning either dimension clears the bitmap
      scratch.height = canvas.height;
      const g = scratch.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(canvas, -x0, 0);

      const d = g.getImageData(0, 0, cw, scratch.height).data;
      let maxA = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > maxA) maxA = d[i]!;

      const ground = mix(mix(GROUND_RGB, INK, maxA / 255), GROUND_RGB, veilAlpha);
      setRatio(contrast(TEXT, ground));
    };

    const id = window.setInterval(() => {
      if (performance.now() - hotRef.current < SETTLE) read();
    }, METER_MS);
    return () => window.clearInterval(id);
  }, [drawsTerrain, ready, sceneW, veilAlpha]);

  const passes = ratio !== null && ratio >= AA;

  return (
    <div>
      <p className="text-[10px]" style={{ color: DIM, marginBottom: 8 }}>
        Behind every page, all the way down
      </p>

      <div
        ref={stageRef}
        onPointerMove={drawsTerrain ? touch : undefined}
        onPointerDown={drawsTerrain ? touch : undefined}
        style={{
          position: "relative",
          height: STAGE_H,
          borderRadius: 8,
          border: `1px solid ${WIRE}`,
          background: GROUND,
          overflow: "hidden",
          cursor: live ? "crosshair" : "default",
          touchAction: live ? "none" : undefined,
        }}
      >
        {ready && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: sceneW,
              height: sceneH,
              transformOrigin: "top left",
              transform: `scale(${scale})`,
            }}
          >
            {drawsTerrain ? (
              <TerrainLayer
                stageRef={stageRef}
                heroRef={heroRef}
                canvasRef={canvasRef}
                w={sceneW}
                h={sceneH}
                strength={strength}
                cell={cell}
                levels={levels}
                minor={minor}
                major={major}
                channel={channel}
                interactive={interactive}
                reducedMotion={reduced}
              />
            ) : (
              <LinesLayer beams={!reduced && !narrow} />
            )}

            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 1,
                background: `rgba(${GROUND_RGB.join(", ")}, ${veilAlpha})`,
                pointerEvents: "none",
              }}
            />

            <ChannelMarks sceneW={sceneW} mode={drawsTerrain && channel ? "erased" : "drawn"} />

            <FakePage heroRef={heroRef} />
          </div>
        )}
      </div>

      {drawsTerrain && (
        <div className="mt-2" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={`chip${ratio === null ? "" : passes ? " on" : " bad"}`}>
            {ratio === null
              ? "behind text —"
              : `behind text ${ratio.toFixed(1)}:1 ${passes ? "AA ✓" : "fails"}`}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".06em", color: FAINT }}>
            worst pixel in the 720px column, under the veil, against the faintest grey the page sets — WCAG wants {AA}:1
          </span>
        </div>
      )}

      <Note>
        {terrain
          ? narrow
            ? "not drawn at this width — v2 is a desktop layer, and the page falls back to bare ground"
            : reduced
              ? "reduced motion — one static frame, then the loop stops"
              : interactive
                ? "move the pointer inside the frame · click to drop a ripple"
                : "interaction off — the map draws itself in once and holds"
          : "the lines · fifty paths and fourteen beams, frozen here mid-sweep"}
      </Note>
      <Note>
        {narrow
          ? terrain
            ? "at this width the pane stands in for itself — and 1024px is the cutoff, so the map is never built rather than built and erased"
            : "at this width the pane stands in for itself — the beams stop here, the fifty lines do not"
          : `standing in for a ${SCENE_W}px viewport, so the 720px column keeps the share of the frame it really has`}
      </Note>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".06em", color: FAINT }}>
      {children}
    </p>
  );
}

function TerrainLayer({
  stageRef,
  heroRef,
  canvasRef,
  w,
  h,
  ...options
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  heroRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  w: number;
  h: number;
  strength: number;
  cell: number;
  levels: number;
  minor: number;
  major: number;
  channel: boolean;
  interactive: boolean;
  reducedMotion: boolean;
}) {
  const handleRef = useRef<TerrainHandle | null>(null);
  const sizeRef = useRef({ w, h });
  const optionsRef = useRef(options);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const handle = createTerrain(
      {
        canvas,
        ink: () => INK,
        dark: () => true,
        size: () => sizeRef.current,
        heroBottom: () => {
          const el = heroRef.current;
          return el ? el.offsetTop + el.offsetHeight : null;
        },
        events: stage,
      },
      optionsRef.current
    );
    handleRef.current = handle;

    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [stageRef, heroRef, canvasRef]);

  // createTerrain sizes itself on construction
  const sized = useRef(false);
  useEffect(() => {
    sizeRef.current = { w, h };
    if (!sized.current) { sized.current = true; return; }
    handleRef.current?.resize();
  }, [w, h]);

  const { strength, cell, levels, minor, major, channel, interactive, reducedMotion } = options;
  useEffect(() => {
    const next = { strength, cell, levels, minor, major, channel, interactive, reducedMotion };
    optionsRef.current = next;
    handleRef.current?.update(next);
  }, [strength, cell, levels, minor, major, channel, interactive, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", top: 0, left: 0, zIndex: 0, display: "block" }}
    />
  );
}

const paths = [
  "M-380 -189C-380 -189 -312 216 152 343C616 470 684 875 684 875",
  "M-373 -197C-373 -197 -305 208 159 335C623 462 691 867 691 867",
  "M-366 -205C-366 -205 -298 200 166 327C630 454 698 859 698 859",
  "M-359 -213C-359 -213 -291 192 173 319C637 446 705 851 705 851",
  "M-352 -221C-352 -221 -284 184 180 311C644 438 712 843 712 843",
  "M-345 -229C-345 -229 -277 176 187 303C651 430 719 835 719 835",
  "M-338 -237C-338 -237 -270 168 194 295C658 422 726 827 726 827",
  "M-331 -245C-331 -245 -263 160 201 287C665 414 733 819 733 819",
  "M-324 -253C-324 -253 -256 152 208 279C672 406 740 811 740 811",
  "M-317 -261C-317 -261 -249 144 215 271C679 398 747 803 747 803",
  "M-310 -269C-310 -269 -242 136 222 263C686 390 754 795 754 795",
  "M-303 -277C-303 -277 -235 128 229 255C693 382 761 787 761 787",
  "M-296 -285C-296 -285 -228 120 236 247C700 374 768 779 768 779",
  "M-289 -293C-289 -293 -221 112 243 239C707 366 775 771 775 771",
  "M-282 -301C-282 -301 -214 104 250 231C714 358 782 763 782 763",
  "M-275 -309C-275 -309 -207 96 257 223C721 350 789 755 789 755",
  "M-268 -317C-268 -317 -200 88 264 215C728 342 796 747 796 747",
  "M-261 -325C-261 -325 -193 80 271 207C735 334 803 739 803 739",
  "M-254 -333C-254 -333 -186 72 278 199C742 326 810 731 810 731",
  "M-247 -341C-247 -341 -179 64 285 191C749 318 817 723 817 723",
  "M-240 -349C-240 -349 -172 56 292 183C756 310 824 715 824 715",
  "M-233 -357C-233 -357 -165 48 299 175C763 302 831 707 831 707",
  "M-226 -365C-226 -365 -158 40 306 167C770 294 838 699 838 699",
  "M-219 -373C-219 -373 -151 32 313 159C777 286 845 691 845 691",
  "M-212 -381C-212 -381 -144 24 320 151C784 278 852 683 852 683",
  "M-205 -389C-205 -389 -137 16 327 143C791 270 859 675 859 675",
  "M-198 -397C-198 -397 -130 8 334 135C798 262 866 667 866 667",
  "M-191 -405C-191 -405 -123 0 341 127C805 254 873 659 873 659",
  "M-184 -413C-184 -413 -116 -8 348 119C812 246 880 651 880 651",
  "M-177 -421C-177 -421 -109 -16 355 111C819 238 887 643 887 643",
  "M-170 -429C-170 -429 -102 -24 362 103C826 230 894 635 894 635",
  "M-163 -437C-163 -437 -95 -32 369 95C833 222 901 627 901 627",
  "M-156 -445C-156 -445 -88 -40 376 87C840 214 908 619 908 619",
  "M-149 -453C-149 -453 -81 -48 383 79C847 206 915 611 915 611",
  "M-142 -461C-142 -461 -74 -56 390 71C854 198 922 603 922 603",
  "M-135 -469C-135 -469 -67 -64 397 63C861 190 929 595 929 595",
  "M-128 -477C-128 -477 -60 -72 404 55C868 182 936 587 936 587",
  "M-121 -485C-121 -485 -53 -80 411 47C875 174 943 579 943 579",
  "M-114 -493C-114 -493 -46 -88 418 39C882 166 950 571 950 571",
  "M-107 -501C-107 -501 -39 -96 425 31C889 158 957 563 957 563",
  "M-100 -509C-100 -509 -32 -104 432 23C896 150 964 555 964 555",
  "M-93 -517C-93 -517 -25 -112 439 15C903 142 971 547 971 547",
  "M-86 -525C-86 -525 -18 -120 446 7C910 134 978 539 978 539",
  "M-79 -533C-79 -533 -11 -128 453 -1C917 126 985 531 985 531",
  "M-72 -541C-72 -541 -4 -136 460 -9C924 118 992 523 992 523",
  "M-65 -549C-65 -549 3 -144 467 -17C931 110 999 515 999 515",
  "M-58 -557C-58 -557 10 -152 474 -25C938 102 1006 507 1006 507",
  "M-51 -565C-51 -565 17 -160 481 -33C945 94 1013 499 1013 499",
  "M-44 -573C-44 -573 24 -168 488 -41C952 86 1020 491 1020 491",
  "M-37 -581C-37 -581 31 -176 495 -49C959 78 1027 483 1027 483",
];

const allPathsD = paths.join("");

const BEAMS: { i: number; dur: number; delay: number }[] = [
  { i: 0, dur: 8.5, delay: 0 },
  { i: 4, dur: 10, delay: 1.1 },
  { i: 7, dur: 7.5, delay: 2.4 },
  { i: 11, dur: 9.5, delay: 0.6 },
  { i: 14, dur: 8, delay: 3.2 },
  { i: 18, dur: 11, delay: 1.7 },
  { i: 21, dur: 7, delay: 4.1 },
  { i: 25, dur: 9, delay: 0.3 },
  { i: 28, dur: 10.5, delay: 2.9 },
  { i: 32, dur: 8, delay: 1.4 },
  { i: 35, dur: 9.5, delay: 3.7 },
  { i: 39, dur: 7.5, delay: 0.9 },
  { i: 43, dur: 10, delay: 2.1 },
  { i: 47, dur: 8.5, delay: 3.5 },
];

const BEAM_T = 6;

function frozenOffset(dur: number, delay: number): number {
  const elapsed = BEAM_T - delay;
  if (elapsed <= 0) return 2;
  return 2 - 2 * ((elapsed % dur) / dur);
}

function LinesLayer({ beams }: { beams: boolean }) {
  return (
    <>
      <svg
        style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%" }}
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d={allPathsD} stroke="url(#bgp-lines-radial)" strokeOpacity="0.05" strokeWidth="0.5" />
        <defs>
          <radialGradient
            id="bgp-lines-radial"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(352 34) rotate(90) scale(555 1560.62)"
          >
            <stop offset="0.0666667" stopColor="#fafafa" />
            <stop offset="0.243243" stopColor="#fafafa" />
            <stop offset="0.43594" stopColor="#fafafa" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      {beams && (
        <svg
          style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%" }}
          width="100%"
          height="100%"
          viewBox="0 0 696 316"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {BEAMS.map(({ i, dur, delay }) => (
            <path
              key={i}
              d={paths[i]}
              pathLength={1}
              stroke="url(#bgp-beam)"
              strokeOpacity="0.4"
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeDasharray="0.22 1.78"
              strokeDashoffset={frozenOffset(dur, delay)}
            />
          ))}
          <defs>
            <linearGradient id="bgp-beam" gradientUnits="userSpaceOnUse" x1="-380" y1="-580" x2="1030" y2="880">
              <stop offset="0" stopColor="#18CCFC" stopOpacity="0" />
              <stop offset="0.2" stopColor="#18CCFC" />
              <stop offset="0.55" stopColor="#6344F5" />
              <stop offset="1" stopColor="#AE48FF" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      )}
    </>
  );
}

function ChannelMarks({ sceneW, mode }: { sceneW: number; mode: "erased" | "drawn" }) {
  const half = sceneW / 2;
  const edge = (x: number, o: number) => (
    <span
      key={x}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: half + x,
        borderLeft: `1px dashed rgba(250,250,250,${o})`,
      }}
    />
  );

  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
      {edge(-CH_OUTER, 0.07)}
      {edge(CH_OUTER, 0.07)}
      {edge(-CH_INNER, 0.16)}
      {edge(CH_INNER, 0.16)}
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 14,
          letterSpacing: ".1em",
          color: mode === "erased" ? "rgba(250,250,250,.34)" : "rgba(250,250,250,.2)",
        }}
      >
        {mode === "erased" ? "720px reading channel — erased" : "720px reading channel — drawn through"}
      </span>
    </div>
  );
}

function FakePage({ heroRef }: { heroRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      <div style={{ width: 768, maxWidth: "100%", margin: "0 auto", padding: "0 24px" }}>
        <div ref={heroRef} style={{ padding: "44px 0 20px" }}>
          <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: DIM }}>
            the page, at rest
          </p>
          <h1 style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1.02, color: "#fafafa", margin: "12px 0 0" }}>
            Nameplate
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: DIM, margin: "12px 0 0" }}>
            The line under it, set at the size the hero sets it.
          </p>
        </div>

        <div style={{ borderTop: `1px solid ${WIRE}`, paddingTop: 26 }}>
          <p style={{ fontSize: 12, color: DIM, margin: 0 }}>Body copy</p>
          <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", color: "#fafafa", margin: "4px 0 12px" }}>
            The words the map has to stay out of
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.75, color: "#fafafa", margin: 0 }}>
            Fourteen-pixel type in the column the contours are erased out of. If a line
            crosses a word here, the strength is too high — that is the whole judgement
            this pane exists to let you make.
          </p>
          <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".04em", color: DIM, margin: "14px 0 0" }}>
            a mono line, 11px — the first thing the map takes down
          </p>
        </div>
      </div>
    </div>
  );
}
