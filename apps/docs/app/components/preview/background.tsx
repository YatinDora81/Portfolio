"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createTerrain, type TerrainHandle } from "@repo/ui/terrain";
import { DIM, FAINT, MONO } from "./frame";

// ─── Background Preview ──────────────────────────────────────────
// What draws under every page, in the two layers the card above picks between.
//
//   v1 "the lines" — a static mirror of
//      apps/web/app/components/common/BackgroundLines.tsx: the same fifty-path
//      field at the same 0.05 stroke opacity under the same radial gradient,
//      and the fourteen beams frozen at one instant of their sweep. Nothing on
//      this page can tune it, so the pane only has to prove which layer is live.
//
//   v2 "the terrain" — not a mirror. This is the real engine from
//      @repo/ui/terrain, running the draft settings on a real canvas, because a
//      hand-drawn stand-in for a contour map is a picture of a decision rather
//      than the decision. Move the pointer inside the frame and the field flows;
//      click and it ripples, exactly as it will for a visitor.
//
// Over both: the veil at its own opacity, and a strip of page type inside the
// 720px column, because "is the map too strong" is only answerable next to the
// words it would be sitting behind — stacked in the site's own order, map under
// veil under type, or the pane would be judging a page nobody is served.
//
// Under it: the contrast meter ported from the source, which is the number the
// strip of type can only gesture at.

/** The site's dark `--foreground`, and the ground the frame pins the pane to.
 *  Deliberately not an admin token: `PreviewFrame` holds this pane on the
 *  portfolio's dark palette in all three control-room themes, so ink read from
 *  `--ink` would paint the map black on black the moment the admin went light. */
const INK: [number, number, number] = [250, 250, 250];
const GROUND = "#0a0a0a";

/** apps/web `--border`, dark — every hairline in the fake page. */
const WIRE = "rgba(255,255,255,0.1)";

/** The v1 veil, which is not a dial: `Background.tsx`'s lines branch hard-codes
 *  `bg-background/50`, and only the terrain reads `terrainVeil`. Pinning it here
 *  is the difference between the pane showing the site and the pane showing a
 *  page that cannot exist — the dials keep their last values after a flip back
 *  to v1, so without this the lines end up under whatever the map was tuned to. */
const V1_VEIL = 0.5;

/**
 * The pane stands in for a 1280px laptop instead of reducing the type by hand
 * the way every other preview in this folder does, and the reading channel is
 * what forces it: the engine erases a fixed 720px column (Container is
 * max-w-3xl), so a canvas driven at the pane's own ~800px would have the channel
 * swallow the entire frame and leave nothing to judge. Scene coordinates in, one
 * uniform transform out — the column keeps the share of the frame it really has.
 */
const SCENE_W = 1280;

/** Below this the pane IS the frame's 390px phone, so it stands in for itself —
 *  and a 720px channel wider than the viewport is the truth there, not a bug. */
const NARROW = 520;

/** The stage, in pane pixels. Tall enough that the hero taper and the body
 *  channel are both on screen at once; the scene height follows from it. */
const STAGE_H = 360;

/** CH_INNER / CH_OUTER in packages/ui/src/terrain.ts. Duplicated rather than
 *  exported because they are the *engine's* geometry and this is only a ruler
 *  drawn over it — if the two ever disagree, the hairlines are the wrong one. */
const CH_INNER = 360;
const CH_OUTER = 450;

// ─── the contrast meter ──────────────────────────────────────────
// terrain-50.html's `measure()`, ported because it is the only instrument that
// makes the strength decision answerable, and because the dials on this page
// reach well past where the channel constants in terrain.ts were solved:
// strength to 100, minor to 60, major to 90, and a one-click `channel: off`.
// The strip of type above says "a line crosses a word"; this says how far.
//
// Worst pixel inside the column, composited exactly the way the page composites
// it — the map's ink over the ground at whatever alpha survived the erase, then
// the veil, then the type on top. Alpha is all that varies: the canvas is one
// ink. WCAG 1.4.3 wants 4.5:1 for normal text.

const AA = 4.5;

/** `#rrggbb` → the channels the compositing works in. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const GROUND_RGB = rgb(GROUND);

/** The dimmest type the portfolio sets on this ground — apps/web's dark
 *  `--secondary-ink`, which is exactly what `DIM` is. Read off `DIM` rather than
 *  repeated, so the meter can never be measuring a colour the pane stopped
 *  drawing. The map is worst against the faintest grey, so this is the test. */
const TEXT = rgb(DIM);

/** How long after the last change the field can still be moving: a ripple runs
 *  out over 2.2s and the draw-in takes 1.4s, so 2.6s covers the slowest of the
 *  two with a tick to spare. Past it, the last reading is the reading. */
const SETTLE = 2600;

/** The source re-read every 1.2s for as long as its loop ran. */
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
  // Held here rather than inside TerrainLayer because the meter reads the same
  // pixels the engine writes, and the veil it has to composite over is a prop
  // of this component, not of the layer.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);

  // The blanket `.cr * { animation: none !important }` in control-room.css
  // cannot touch a rAF loop, so the loop has to ask for itself — the same
  // arrangement the nap tiles use. Read after mount only: this renders on the
  // server too, and a media query there would disagree with the first client pass.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // The scene is measured, never assumed: the frame's device toggle changes the
  // pane width without changing anything this component is told.
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
  // Below 1024px apps/web builds no canvas at all (BackgroundTerrain.tsx), so
  // neither does the pane. Judging v2 at the frame's phone width against a map
  // the visitor is never shown is the one way this preview could lie outright —
  // and it is the width where the difference from v1, which keeps its fifty
  // lines all the way down, actually matters to the choice being made here.
  const drawsTerrain = terrain && !narrow;
  const live = drawsTerrain && interactive && !reduced;
  // v1's veil is not on any dial — see V1_VEIL. One value for the div and for
  // the meter, so what is measured is what is drawn.
  const veilAlpha = terrain ? veil : V1_VEIL;

  /* ── the meter ─────────────────────────────────────────────────── */

  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  // Last moment the field could still have been moving. Everything that changes
  // what is drawn stamps it, and the meter only reads pixels inside its window:
  // the engine's loop sleeps, and a readback ticking on forever under an idle
  // map is precisely the cost that whole design refuses to pay.
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

      // The engine writes `canvas.width` in device pixels and `style.width` in
      // scene ones, so the ratio between them is the DPR it settled on.
      const dpr = canvas.width / sceneW;
      const x0 = Math.max(0, Math.round((sceneW / 2 - CH_INNER) * dpr));
      const cw = Math.min(canvas.width, Math.round(2 * CH_INNER * dpr));

      // A scratch canvas rather than reading the live one: repeated getImageData
      // on the surface the engine is drawing into is what pushes a canvas off
      // the GPU. Copied 1:1 at device resolution, unlike the source, which drew
      // down to CSS pixels — resampling averages the worst pixel away, and this
      // number is only useful if it rounds toward failing.
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
        // The engine takes the pointer straight off this element, so the meter
        // never hears about it — these two keep its window open for as long as
        // someone is pushing the field around inside the box.
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
          // The engine reads pointermove off this element, so a touch drag has to
          // reach it as a pointer event rather than being eaten as a pane scroll.
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
            {/* z-0 · the layer itself — the site's own stacking order, kept */}
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

            {/* z-1 · the veil — apps/web's `bg-background/50`, on its own dial
                under the terrain and pinned under the lines. A flat rgba rather
                than an opacity, which would put the whole layer on the
                compositor for a fill that never changes. */}
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

            {/* the ruler: where the 720px column sits, and where its feather
                runs out. Over the veil so it stays readable at 90%, under the
                page because it is scaffolding and the page is the subject. */}
            <ChannelMarks sceneW={sceneW} mode={drawsTerrain && channel ? "erased" : "drawn"} />

            {/* z-2 · the page */}
            <FakePage heroRef={heroRef} />
          </div>
        )}
      </div>

      {/* Above the notes, not below them: it is the only thing on this page
          that can say no to a setting. */}
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

// ─── v2 · the real engine ────────────────────────────────────────

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
  // The engine calls `size()` once per resize and must never read it off the
  // canvas — `resize()` writes explicit pixel dimensions onto the element, so a
  // size derived from its own box would freeze at whatever it last returned.
  const sizeRef = useRef({ w, h });
  const optionsRef = useRef(options);

  useEffect(() => {
    const canvas = canvasRef.current;
    // Both, and not just the canvas: `events` falling through to `undefined`
    // hands the engine its full-page mode, where pointer coordinates are read
    // as viewport coordinates and a scroll listener goes on the window. That is
    // a silently wrong pane rather than a missing one. It cannot happen — this
    // layer only mounts once the stage's ResizeObserver has reported — so the
    // guard is here to keep it that way, not because the ref is ever null.
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const handle = createTerrain(
      {
        canvas,
        // Two constants behind two closures: the contract asks for these to be
        // memoised because the frame asks for them every frame, and here there
        // is nothing to memoise — the pane's palette is pinned.
        ink: () => INK,
        dark: () => true,
        size: () => sizeRef.current,
        heroBottom: () => {
          const el = heroRef.current;
          // Scene coordinates, and the canvas does not scroll inside the scene,
          // so the laid-out offset is the edge — the site's rect-relative read
          // is only needed where the canvas is fixed and the hero scrolls past it.
          // Transforms do not touch offsetTop, so the scale above is irrelevant.
          return el ? el.offsetTop + el.offsetHeight : null;
        },
        // Bound to the stage rather than the window so the flow, the press rings
        // and the ripples all answer to the pointer *inside the box* — which is
        // the only place the owner can try them before publishing.
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

  // `createTerrain` sizes itself on construction, so the first run of this
  // effect would rebuild the backing store, the channel gradient and the grid
  // for a dimension that has not moved yet.
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
    // No `resize()` alongside it: `update()` reallocates the grid itself when the
    // cell pitch changes, and a resize here would rebuild the backing store and
    // the channel gradient for a dimension that has not moved.
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

// ─── v1 · the lines, mirrored ────────────────────────────────────
// Copied from apps/web/app/components/common/BackgroundLines.tsx, which is v1
// and is not touched by any of this. Same fifty paths, same viewBox, same
// stroke weights and opacities; only three things change, and all three are
// because this is a pane and not the page:
//
//   · the gradient ids are prefixed, so nothing here can ever collide with a
//     site id (the source's are hard-coded and would);
//   · the radial stops pin `#fafafa` where the site writes `var(--foreground)`,
//     which does not exist inside the control room;
//   · the beams hold one frame instead of sweeping — the panes in this folder
//     have never animated, and a CSS sweep here would be killed by the
//     control room's reduced-motion guard anyway.

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

/** The source's own table, verbatim — which lines carry a beam, and the fixed
 *  duration and delay each was given so the spread is deterministic. */
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

/** Six seconds into the sweep. Late enough that every beam has cleared its
 *  delay, and the fourteen dashes land scattered rather than in a comb. */
const BEAM_T = 6;

/** `beamSweep` runs stroke-dashoffset 2 → 0 over `dur`, on repeat, after
 *  `delay`. This is that animation, evaluated once at BEAM_T. */
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

      {/* Dropped under reduced motion and below 1024px, because the site drops
          the whole beam layer in both cases — a pane that kept them would be
          showing a background half its visitors never get. */}
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

// ─── the ruler and the page ──────────────────────────────────────

/** `erased` is the terrain's channel doing its job; `drawn` is either layer
    putting ink through the column. v1 has no erase at all, so it can never be
    the first — captioning it "erased" described the one comparison this pane
    exists to support, backwards. */
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

/**
 * Stand-in page type, at the site's own sizes rather than this folder's reduced
 * ones — the scene scale below already does the reducing, and the point of the
 * strip is the ratio between the column and the map, which only survives if both
 * are drawn in the same coordinates. The hero block is measured, not guessed:
 * the engine tapers its erase at whatever y this div ends on.
 */
function FakePage({ heroRef }: { heroRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    // z-2, the same order the site stacks in: content sits above the veil
    // (`relative z-[2]` on every page), so nothing the visitor reads is ever
    // dimmed by it. A pane that veiled its own words would show the map doing
    // damage it does not do, and the strength dial would be tuned down to fix
    // a page that was never broken.
    //
    // Absolute at the scene's origin rather than in flow, so it is also the
    // hero's offset parent at exactly y=0 — `offsetTop` stays the scene
    // coordinate the engine's `heroBottom()` is read in.
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {/* Container.tsx: max-w-3xl (768) with px-6, which is the 720 of content
          the engine's ±360 erase is cut to. Border-box, so 768 here is 720 of
          type — the hairlines either side of it are the same 720. */}
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

        {/* Everything below this rule is where the erase steps up to body
            strength — display type at 64/800 shrugs the map off, 14px copy does not. */}
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
