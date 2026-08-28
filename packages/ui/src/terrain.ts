/**
 * The terrain background — a contour map of a noise field, drawn on a canvas.
 *
 * Framework-free on purpose: the public site drives it from a client component
 * and the admin drives the *same* engine inside a preview frame, so the two can
 * never drift into showing different maps. Nothing here touches `window` or
 * `document` at module scope, so importing this from a server bundle is inert.
 *
 * Two rules run everything below, and both are perf rules as much as design
 * rules:
 *
 *   1. Still while you read. No frame is drawn unless something is actually
 *      moving — the pointer, a ripple, the draw-in. At rest the loop stops
 *      calling requestAnimationFrame entirely; it is not a paused loop, it is
 *      no loop. Everything that can start motion goes through `wake()`.
 *
 *      Scrolling is not motion of the map. It moves the erased strip in rule 2
 *      and nothing else, so a scroll that cannot move that strip — no hero to
 *      taper against, the taper already gone past, the channel off, reduced
 *      motion — wakes nothing, and one that can reuses the contours it has
 *      instead of computing the same ones again (`wake(false)`).
 *
 *   2. The effect lives in the margins. After the contours are drawn, the strip
 *      where the site's 768px reading column sits is erased back out again. The
 *      map is decoration; the type is the page.
 *
 * Host contract, because three of these are easy to get wrong:
 *   - `ink()` and `dark()` are called once per frame. Memoise them on the host
 *     side (read the custom properties once, re-read on a theme class change) —
 *     a `getComputedStyle` per frame is a style recalc per frame.
 *   - `heroBottom()` is called once per frame and once per scroll event, from
 *     inside a rAF callback, which runs before style and layout for that frame.
 *     Cache the hero's page-space bottom and subtract the scroll offset; a
 *     `getBoundingClientRect()` here forces a synchronous layout per frame on
 *     any page that has something else animating.
 *   - `size()` must NOT be measured off the canvas itself. `resize()` writes
 *     explicit pixel dimensions onto the element, so a `size()` that read the
 *     canvas box would freeze at whatever it last returned. Measure the viewport
 *     or the containing box.
 */

export interface TerrainOptions {
  /** Master line-opacity multiplier, 0..1. */
  strength: number;
  /** Marching-squares grid pitch in CSS px. Smaller = finer contours, more work. */
  cell: number;
  /** How many contour levels the 0..1 field is sliced into. */
  levels: number;
  /** Alpha of an ordinary contour, 0..1. */
  minor: number;
  /** Alpha of a major contour (every 4th line), 0..1. */
  major: number;
  /** Pointer flow, press rings and click ripples. */
  interactive: boolean;
  /** Erase the reading channel so the site's text column stays legible. */
  channel: boolean;
  /** No flow, no ripples, no draw-in: one static frame and stop. */
  reducedMotion: boolean;
}

export interface TerrainHost {
  canvas: HTMLCanvasElement;
  /** [r,g,b] ink, re-read on demand so a theme flip is picked up */
  ink: () => [number, number, number];
  dark: () => boolean;
  /** logical CSS px size of the drawing surface */
  size: () => { w: number; h: number };
  /** y (in surface coords) where the hero ends and the body channel takes over; null = body strength everywhere */
  heroBottom?: () => number | null;
  /** element pointer/scroll events are read from; defaults to window for the full-page case */
  events?: HTMLElement;
}

export interface TerrainHandle {
  update(next: Partial<TerrainOptions>): void;
  resize(): void;
  destroy(): void;
}

export const TERRAIN_DEFAULTS: TerrainOptions = {
  strength: 0.5,
  cell: 12,
  levels: 14,
  minor: 0.2,
  major: 0.48,
  interactive: true,
  channel: true,
  reducedMotion: false,
};

/* ── the numbers, and why they are those numbers ──────────────────────── */

/**
 * Retina is 2, some Android phones report 3, and the contours are hairlines —
 * past 1.5 the extra samples buy nothing you can see and cost the whole
 * fullscreen fill rate. Capped, not honoured.
 */
const DPR_CAP = 1.5;

/** The map draws itself in over this, then holds. Long enough to read as an arrival. */
const DRAW_IN_MS = 1400;

const RIPPLE_LIFE = 2.2; // seconds
const RIPPLE_SPEED = 300; // px/s the ring front travels
const RIPPLE_BAND = 70; // px either side of the front that the ring lifts

/**
 * Not in the source sketch. A ripple is an extra pass over every grid point for
 * 2.2s, so a mashed pointer is a way to multiply the frame cost by ten. Six is
 * more overlapping rings than anyone can see anyway; the oldest is dropped.
 */
const MAX_RIPPLES = 6;

const NOISE_S = 0.0066; // world scale of the first octave
const PRESS = 0.62; // how far the pointer lifts the ground under it
const PRESS_R2 = 52900; // 230px², past which the lift is not worth evaluating
const PRESS_FALLOFF = 15000;

/**
 * The reading channel. `inner` is half the site's text measure (Container is
 * max-w-3xl, 768 − 2×24 of padding = 720 → 360); the feather runs out to 450.
 *
 * The erase strengths are solved, not guessed. For 11px mono labels to hold
 * 4.5:1 (WCAG 1.4.3) at the worst pixel, the canvas alpha inside the column has
 * to stay ≤ .22 over the dark ground and ≤ .12 over white — black ink over white
 * loses contrast faster than white ink over black, which is why the light-mode
 * numbers are the higher pair. The brightest thing the map ever draws is a
 * pointer-lit major contour at .96, so: dark hero ≥ .78, light hero ≥ .88.
 * Anything below those and the text fails, silently, only for some visitors.
 *
 * The hero keeps more of the effect than the body does because display type at
 * 100px/900 is immune to it; the 14px body copy underneath is not.
 */
const CH_INNER = 360;
const CH_OUTER = 450;
const CH_FEATHER = 140;
const CH_DARK = { hero: 0.8, body: 0.92 };
const CH_LIGHT = { hero: 0.9, body: 0.95 };

/**
 * Slack on the "can this scroll change anything" test (`channelKey`). A host is
 * asked to memoise the hero edge, which means resolving it against a scroll
 * offset cached in the host's own listener — one event behind this one — and a
 * single event of a fling is a few hundred px. The slack is what stops a read
 * that stale from leaving a taper frozen just as it comes back into view; past
 * it the erase really is one flat fill and the frame cannot change.
 */
const CH_WAKE_SLACK = 300;

/** Option bounds. A SiteConfig row is a string someone can type — these are the floor. */
const CELL_MIN = 8;
const CELL_MAX = 28;
const LEVELS_MIN = 4;
const LEVELS_MAX = 24;

/* ── seeded improved Perlin noise ─────────────────────────────────────── */

/**
 * Seed 1337, shuffled with a bare Lehmer PRNG rather than Math.random, so the
 * map a visitor sees is the map the admin preview drew. A different seed is a
 * different landscape, and there is no control for it on purpose.
 */
const P = new Uint8Array(512);
{
  const perm = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255]!;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);

const grad = (h: number, x: number, y: number, z: number) => {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
};

/**
 * Every index into P below is masked into 0..255 and then offset by at most 255,
 * which is exactly why the table is 512 long and not 256 — the reads cannot go
 * out of range, so the `!`s are proofs rather than hopes. Without them
 * `noUncheckedIndexedAccess` puts fourteen undefined-checks in the innermost
 * loop of the frame.
 */
function noise3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = P[X]! + Y;
  const AA = P[A]! + Z;
  const AB = P[A + 1]! + Z;
  const B = P[X + 1]! + Y;
  const BA = P[B]! + Z;
  const BB = P[B + 1]! + Z;
  return lerp(
    lerp(
      lerp(grad(P[AA]! & 15, x, y, z), grad(P[BA]! & 15, x - 1, y, z), u),
      lerp(grad(P[AB]! & 15, x, y - 1, z), grad(P[BB]! & 15, x - 1, y - 1, z), u),
      v
    ),
    lerp(
      lerp(grad(P[AA + 1]! & 15, x, y, z - 1), grad(P[BA + 1]! & 15, x - 1, y, z - 1), u),
      lerp(grad(P[AB + 1]! & 15, x, y - 1, z - 1), grad(P[BB + 1]! & 15, x - 1, y - 1, z - 1), u),
      v
    ),
    w
  );
}

/* ── marching squares ─────────────────────────────────────────────────── */

/**
 * One row of four per corner mask, edges numbered 0 top, 1 right, 2 bottom,
 * 3 left. Masks 0 and 15 have no crossing; 5 and 10 are the saddles and need
 * two segments. -1 pads the rows that need one. Flat and typed so the lookup in
 * the hot loop is an array read and not a property miss.
 */
const MS_EDGES = new Int8Array([
  -1, -1, -1, -1, //  0
  3, 2, -1, -1, //  1
  2, 1, -1, -1, //  2
  3, 1, -1, -1, //  3
  0, 1, -1, -1, //  4
  0, 1, 2, 3, //  5
  0, 2, -1, -1, //  6
  0, 3, -1, -1, //  7
  0, 3, -1, -1, //  8
  0, 2, -1, -1, //  9
  0, 3, 1, 2, // 10
  0, 1, -1, -1, // 11
  3, 1, -1, -1, // 12
  1, 2, -1, -1, // 13
  3, 2, -1, -1, // 14
  -1, -1, -1, -1, // 15
]);
const MS_COUNT = new Int8Array([0, 2, 2, 2, 2, 4, 2, 2, 2, 2, 4, 2, 2, 2, 2, 0]);

/* ── options ──────────────────────────────────────────────────────────── */

function num(value: number, lo: number, hi: number, fallback: number): number {
  const n = Number.isFinite(value) ? value : fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Clamped here as well as in the admin's save action. Both ends coerce because
 * a row can be edited by something that is not the admin, and a cell of 1 is a
 * grid a hundred times larger than the one this was budgeted for.
 */
function clampOptions(next: Partial<TerrainOptions>, base: TerrainOptions): TerrainOptions {
  return {
    strength: num(next.strength ?? base.strength, 0, 1, TERRAIN_DEFAULTS.strength),
    cell: Math.round(num(next.cell ?? base.cell, CELL_MIN, CELL_MAX, TERRAIN_DEFAULTS.cell)),
    levels: Math.round(
      num(next.levels ?? base.levels, LEVELS_MIN, LEVELS_MAX, TERRAIN_DEFAULTS.levels)
    ),
    minor: num(next.minor ?? base.minor, 0, 1, TERRAIN_DEFAULTS.minor),
    major: num(next.major ?? base.major, 0, 1, TERRAIN_DEFAULTS.major),
    interactive: !!(next.interactive ?? base.interactive),
    channel: !!(next.channel ?? base.channel),
    reducedMotion: !!(next.reducedMotion ?? base.reducedMotion),
  };
}

/** A pointerdown on any of these is someone using the page, not pressing the ground. */
const NO_RIPPLE = "a,button,input,textarea,select,summary,[role='button'],[contenteditable]";

/* ── contour storage ──────────────────────────────────────────────────── */

/** A flat run of x0,y0,x1,y1 quads; `n` is how much of `xy` is in use. */
interface Segs {
  xy: Float32Array;
  n: number;
}

/**
 * Grown by doubling and then never again — after the first frame the buffer is
 * already the size the surface needs. A plain array emptied with `length = 0`
 * looks like it reuses its storage and does not: V8 trims the elements store on
 * that assignment, so every frame re-grows it. At the dial maxima that is
 * ~24k segments, ~760KB of fresh storage, sixty times a second.
 */
function pushSeg(s: Segs, x0: number, y0: number, x1: number, y1: number): void {
  if (s.n + 4 > s.xy.length) {
    const grown = new Float32Array(s.xy.length * 2);
    grown.set(s.xy);
    s.xy = grown;
  }
  s.xy[s.n++] = x0;
  s.xy[s.n++] = y0;
  s.xy[s.n++] = x1;
  s.xy[s.n++] = y1;
}

/* ── the engine ───────────────────────────────────────────────────────── */

export function createTerrain(host: TerrainHost, options: TerrainOptions): TerrainHandle {
  const canvas = host.canvas;
  const ctx = canvas.getContext("2d");
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;

  // A canvas with no 2D context, or one already detached from its window, has
  // nothing to drive. The host still gets a handle it can safely destroy.
  if (!ctx || !win) {
    return { update: () => {}, resize: () => {}, destroy: () => {} };
  }

  // Re-bound with non-null types: the narrowing above does not reach into the
  // closures below, and thirty non-null assertions would read as doubt.
  const g: CanvasRenderingContext2D = ctx;
  const view: Window & typeof globalThis = win;

  let opts = clampOptions(options, TERRAIN_DEFAULTS);
  let destroyed = false;

  let W = 1;
  let H = 1;

  let field = new Float32Array(0);
  let gw = 0;
  let gh = 0;

  let time = 4.2; // an arbitrary offset into the noise, chosen for its landscape
  let flow = opts.reducedMotion ? 0 : 0.22; // a little drift under the draw-in
  const ripples: { x: number; y: number; t: number }[] = [];
  let born = -1;
  let pressMoving = false;

  const mouse = { x: -9e3, y: -9e3, sx: -9e3, sy: -9e3, on: false, vx: 0, vy: 0 };
  let lastSx = mouse.sx;
  let lastSy = mouse.sy;

  let rafId = 0;
  let lastNow = 0;
  let appliedDpr = 0;

  /**
   * False means the field and the contours below still describe what is on
   * screen, so the frame only has to stroke them again. That is the whole point
   * of the split: a scroll moves the reading channel and nothing else, and
   * re-running two octaves of noise over every grid point to produce the same
   * lines in the same places is the single most expensive way to draw nothing.
   */
  let fieldDirty = true;

  let chGrad: CanvasGradient | null = null;
  let chGradW = 0;
  // What the taper resolved to on the last drawn frame, so a scroll can tell
  // whether the next frame would be a different picture. NaN until the first
  // frame lands, which makes the first scroll wake unconditionally.
  let lastEdge = Number.NaN;

  // The contours outlive the frame that built them — see `fieldDirty` — so they
  // are typed buffers with a write cursor rather than lists that get emptied.
  const minorSegs: Segs = { xy: new Float32Array(4096), n: 0 };
  const majorSegs: Segs = { xy: new Float32Array(4096), n: 0 };
  const ex = new Float64Array(4);
  const ey = new Float64Array(4);

  /* ── the loop ───────────────────────────────────────────────────────── */

  const active = () => flow > 0.003 || ripples.length > 0 || pressMoving;

  /**
   * `field` false is the scroll case: the map has not moved, only the strip
   * that gets erased out of it, so the frame reuses the contours it already
   * has. Every other caller has changed something the field is built from.
   */
  function wake(field = true): void {
    if (field) fieldDirty = true;
    if (destroyed || rafId) return;
    lastNow = view.performance.now();
    rafId = view.requestAnimationFrame(loop);
  }

  function loop(now: number): void {
    rafId = 0;
    if (destroyed) return;

    // Clamped at both ends. `wake()` stamps `lastNow` from inside an input
    // handler, and a pointer event dispatched during a frame carries a later
    // clock than the rAF timestamp of that same frame — so the wake-from-sleep
    // frame can arrive with `now < lastNow`, and an unclamped dt runs the
    // pointer velocity, the noise and the ripples backwards on exactly the
    // frame the map is waking up for.
    const dt = Math.min(0.05, Math.max(0.004, (now - lastNow) / 1000 || 0.016));
    lastNow = now;

    // The drawn pointer chases the real one. The lag is what makes the rings
    // read as weight pressing on ground rather than a cursor decoration, and
    // its residual velocity is what feeds the flow below.
    const px = mouse.sx;
    const py = mouse.sy;
    mouse.sx += (mouse.x - mouse.sx) * 0.2;
    mouse.sy += (mouse.y - mouse.sy) * 0.2;
    mouse.vx = (mouse.sx - px) / dt;
    mouse.vy = (mouse.sy - py) / dt;

    g.clearRect(0, 0, W, H);
    drawFrame(dt, now);
    eraseChannel();

    const settling = Math.abs(mouse.x - mouse.sx) + Math.abs(mouse.y - mouse.sy) > 0.3;
    if (!opts.reducedMotion && (active() || settling)) {
      // Something is still moving, so whatever the next frame draws is a
      // different field. This is the only place the flag is set from motion.
      fieldDirty = true;
      rafId = view.requestAnimationFrame(loop);
    }
  }

  /* ── one frame ──────────────────────────────────────────────────────── */

  function drawFrame(dt: number, now: number): void {
    const cell = opts.cell;
    const L = opts.levels;
    const reduced = opts.reducedMotion;
    const live = mouse.on && opts.interactive && !reduced;

    if (born < 0) born = now;
    const fadeIn = reduced ? 1 : Math.min(1, (now - born) / DRAW_IN_MS);

    // Flow chases the pointer's speed and then decays toward zero. The two
    // coefficients are per frame rather than per second — tuned at 60Hz, where
    // 0.06 is the ~1s ease-out that lets the map be a still map by the time
    // anyone has finished the sentence they were reading. 0.0016 puts a brisk
    // 900px/s sweep at full speed.
    const speed = live ? Math.hypot(mouse.vx, mouse.vy) : 0;
    flow += (Math.min(1.4, speed * 0.0016) - flow) * (speed > 0 ? 0.12 : 0.06);
    if (reduced) flow = 0;
    time += flow * dt;

    // The eased pointer can still be travelling after the field has frozen —
    // the rings under it are moving even when nothing else is.
    pressMoving = Math.abs(mouse.sx - lastSx) + Math.abs(mouse.sy - lastSy) > 0.4;
    lastSx = mouse.sx;
    lastSy = mouse.sy;

    // Spliced in place rather than reassigned from a filter: this runs every
    // frame for 2.2s after every click, and the filtered copy was a fresh array
    // per frame in the same hot path everything else here is avoiding.
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]!;
      r.t += dt;
      if (r.t >= RIPPLE_LIFE) ripples.splice(i, 1);
    }

    if (fieldDirty) {
      const f = field;
      const mx = mouse.sx;
      const my = mouse.sy;
      const press = live ? PRESS : 0;
      const t = time;
      const nr = ripples.length;

      for (let j = 0; j < gh; j++) {
        const y = j * cell;
        for (let i = 0; i < gw; i++) {
          const x = i * cell;
          // Two octaves: the second is offset in x so it cannot ridge in step
          // with the first, which is what stops the field looking like fabric.
          let v =
            noise3(x * NOISE_S, y * NOISE_S, t * 0.055) * 0.72 +
            noise3(x * NOISE_S * 2.4 + 7, y * NOISE_S * 2.4, t * 0.08) * 0.28;
          v = v * 0.5 + 0.5;

          if (press > 0) {
            const dx = x - mx;
            const dy = y - my;
            const d2 = dx * dx + dy * dy;
            if (d2 < PRESS_R2) v += Math.exp(-d2 / PRESS_FALLOFF) * press;
          }

          // Length-checked and indexed. This is the innermost line of the whole
          // engine — ten thousand visits a frame at the defaults — and a for..of
          // over a list that is empty almost always still builds an iterator on
          // every one of them.
          if (nr) {
            for (let ri = 0; ri < nr; ri++) {
              const r = ripples[ri]!;
              const rx = x - r.x;
              const ry = y - r.y;
              const rd = Math.sqrt(rx * rx + ry * ry) - r.t * RIPPLE_SPEED;
              if (rd > -RIPPLE_BAND && rd < RIPPLE_BAND) {
                v += Math.cos((rd / RIPPLE_BAND) * 1.5708) * 0.42 * (1 - r.t / RIPPLE_LIFE);
              }
            }
          }

          f[j * gw + i] = v;
        }
      }

      marchContours(f, cell, L);
      fieldDirty = false;
    }

    g.lineWidth = 1;
    g.lineJoin = "round";

    const ink = host.ink();
    strokeSegs(minorSegs, opts.minor * fadeIn * opts.strength, ink);
    strokeSegs(majorSegs, opts.major * fadeIn * opts.strength, ink);

    // The draw-in is the one motion nothing else reports, so it keeps the loop
    // awake on its own until it has finished arriving.
    if (fadeIn < 1) pressMoving = true;
  }

  /** The field to contours. Only runs when the field has actually moved. */
  function marchContours(f: Float32Array, cell: number, L: number): void {
    minorSegs.n = 0;
    majorSegs.n = 0;

    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const a = f[j * gw + i]!;
        const b = f[j * gw + i + 1]!;
        const c = f[(j + 1) * gw + i + 1]!;
        const d = f[(j + 1) * gw + i]!;

        // The whole cost story: only the levels that actually fall between this
        // cell's lowest and highest corner are considered. Most cells are flat
        // enough that k1 < k0 and the cell is skipped without any work at all.
        const k0 = Math.max(0, Math.ceil(Math.min(a, b, c, d) * L - 0.5));
        const k1 = Math.min(L - 1, Math.floor(Math.max(a, b, c, d) * L - 0.5));
        if (k1 < k0) continue;

        const x = i * cell;
        const y = j * cell;

        for (let k = k0; k <= k1; k++) {
          const th = (k + 0.5) / L;
          const idx = (a > th ? 8 : 0) | (b > th ? 4 : 0) | (c > th ? 2 : 0) | (d > th ? 1 : 0);
          const n = MS_COUNT[idx]!;
          if (!n) continue;

          ex[0] = x + cell * ((th - a) / (b - a || 1e-6));
          ey[0] = y;
          ex[1] = x + cell;
          ey[1] = y + cell * ((th - b) / (c - b || 1e-6));
          ex[2] = x + cell * ((th - d) / (c - d || 1e-6));
          ey[2] = y + cell;
          ex[3] = x;
          ey[3] = y + cell * ((th - a) / (d - a || 1e-6));

          // Every fourth level is a major contour, the way a survey map indexes
          // its own lines so you can count height without reading every one.
          const out = k % 4 === 1 ? majorSegs : minorSegs;
          const base = idx << 2;
          for (let m = 0; m < n; m += 2) {
            const p = MS_EDGES[base + m]!;
            const q = MS_EDGES[base + m + 1]!;
            pushSeg(out, ex[p]!, ey[p]!, ex[q]!, ey[q]!);
          }
        }
      }
    }
  }

  function strokeSegs(segs: Segs, alpha: number, ink: [number, number, number]): void {
    if (!segs.n || alpha <= 0) return;
    // One path for every line at this weight: two stroke calls per frame, not
    // one per contour.
    g.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${alpha})`;
    g.beginPath();
    const xy = segs.xy;
    for (let i = 0; i < segs.n; i += 4) {
      g.moveTo(xy[i]!, xy[i + 1]!);
      g.lineTo(xy[i + 2]!, xy[i + 3]!);
    }
    g.stroke();
  }

  /* ── the reading channel ────────────────────────────────────────────── */

  /**
   * The erase depends on the hero edge only through this. Above the top of the
   * range the whole surface is hero strength and below the bottom of it the
   * whole surface is body strength — one flat fill either way — so two edges
   * that clamp to the same number paint the same picture, which is what lets a
   * scroll decide it has nothing to redraw. No hero at all is the body end.
   */
  function channelKey(edge: number | null): number {
    const lo = -CH_FEATHER / 2 - CH_WAKE_SLACK;
    const hi = H + CH_FEATHER / 2 + CH_WAKE_SLACK;
    if (edge === null || edge < lo) return lo;
    return edge > hi ? hi : edge;
  }

  function eraseChannel(): void {
    if (!opts.channel) return;

    let gradient = chGrad;
    if (!gradient || chGradW !== W) {
      const cx = W / 2;
      gradient = g.createLinearGradient(0, 0, W, 0);
      gradient.addColorStop(Math.max(0, (cx - CH_OUTER) / W), "rgba(0,0,0,0)");
      gradient.addColorStop(Math.max(0, (cx - CH_INNER) / W), "rgba(0,0,0,1)");
      gradient.addColorStop(Math.min(1, (cx + CH_INNER) / W), "rgba(0,0,0,1)");
      gradient.addColorStop(Math.min(1, (cx + CH_OUTER) / W), "rgba(0,0,0,0)");
      chGrad = gradient;
      chGradW = W;
    }

    const s = host.dark() ? CH_DARK : CH_LIGHT;

    // Reduced motion means one final frame, and the hero taper is the only
    // thing on the surface pinned to page space rather than viewport space —
    // honouring it would mean waking for the rest of the visit to keep it under
    // the hero. Body is the safe end of the pair, so the still map is also the
    // fully protected one.
    let edge: number | null = null;
    if (!opts.reducedMotion && host.heroBottom) edge = host.heroBottom();
    lastEdge = channelKey(edge);

    g.globalCompositeOperation = "destination-out";
    g.fillStyle = gradient;

    if (edge === null) {
      // No hero on this page — the body strength is the safe one, so it is the
      // one that applies everywhere.
      g.globalAlpha = s.body;
      g.fillRect(0, 0, W, H);
    } else {
      const heroS = s.hero;
      const bodyS = s.body;

      const yTop = Math.min(H, edge - CH_FEATHER / 2);
      if (yTop > 0) {
        g.globalAlpha = heroS;
        g.fillRect(0, 0, W, yTop);
      }

      // Seven strips rather than a vertical gradient: the erase is a
      // destination-out fill and the horizontal channel gradient is already
      // spending its one colour ramp. Seven is the point at which the banding
      // stops being visible against a hairline.
      const bands = 7;
      const step = CH_FEATHER / bands;
      for (let i = 0; i < bands; i++) {
        const ys = edge - CH_FEATHER / 2 + i * step;
        if (ys + step < 0 || ys > H) continue;
        g.globalAlpha = heroS + (bodyS - heroS) * ((i + 0.5) / bands);
        g.fillRect(0, ys, W, step + 0.5);
      }

      const yBot = Math.max(0, edge + CH_FEATHER / 2);
      if (yBot < H) {
        g.globalAlpha = bodyS;
        g.fillRect(0, yBot, W, H - yBot);
      }
    }

    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  /* ── sizing ─────────────────────────────────────────────────────────── */

  function allocGrid(): void {
    // +2 so the marching-squares walk has a row and a column past the edge and
    // contours run off the surface instead of stopping short of it.
    gw = Math.ceil(W / opts.cell) + 2;
    gh = Math.ceil(H / opts.cell) + 2;
    const n = gw * gh;
    if (field.length !== n) field = new Float32Array(n);
  }

  function resize(): void {
    if (destroyed) return;
    const s = host.size();
    const w = Math.max(1, Math.round(s.w));
    const h = Math.max(1, Math.round(s.h));
    const dpr = Math.min(view.devicePixelRatio || 1, DPR_CAP);

    // Most resize events do not resize anything: `size()` reads the document
    // element, which does not move when a scrollbar appears, when Android's URL
    // bar collapses mid-scroll, or when the soft keyboard opens. Writing
    // canvas.width reallocates and zeroes the bitmap even when the value it is
    // given is the value it already holds — 11MB at 1440x900 — so the cheapest
    // thing this function can do is notice it has nothing to do.
    if (w === W && h === H && dpr === appliedDpr) return;

    W = w;
    H = h;
    appliedDpr = dpr;

    // Writing width/height resets the whole 2D state, transform included, so
    // the transform goes back on afterwards and never before.
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    chGrad = null;
    allocGrid();
    wake();
  }

  /* ── input ──────────────────────────────────────────────────────────── */

  // One scratch point: pointermove fires often enough that a fresh object per
  // event is a garbage source and nothing else.
  const pt = { x: 0, y: 0 };

  function toSurface(e: PointerEvent): { x: number; y: number } {
    if (!host.events) {
      // Full-page case: the canvas is fixed inset-0, so client coords already
      // are surface coords.
      pt.x = e.clientX;
      pt.y = e.clientY;
      return pt;
    }
    // Boxed case (the admin preview): the canvas sits somewhere in a scrolled
    // page and may be drawn at a size that is not its CSS box. Reading the rect
    // here does not force a layout — the engine only ever writes to the canvas
    // bitmap, so layout is still clean when the pointer moves.
    const r = canvas.getBoundingClientRect();
    pt.x = (e.clientX - r.left) * (r.width > 0 ? W / r.width : 1);
    pt.y = (e.clientY - r.top) * (r.height > 0 ? H / r.height : 1);
    return pt;
  }

  const teardown: (() => void)[] = [];
  function listen(
    target: EventTarget,
    type: string,
    fn: EventListener,
    o?: AddEventListenerOptions
  ): void {
    target.addEventListener(type, fn, o);
    teardown.push(() => target.removeEventListener(type, fn, o));
  }

  const moveTarget: EventTarget = host.events ?? view;
  const leaveTarget: EventTarget = host.events ?? doc;

  listen(
    moveTarget,
    "pointermove",
    (e) => {
      const p = toSurface(e as PointerEvent);
      mouse.x = p.x;
      mouse.y = p.y;
      if (!mouse.on) {
        // First sighting: land the eased pointer on the real one rather than
        // letting it fly in from the off-screen resting position.
        mouse.sx = p.x;
        mouse.sy = p.y;
        lastSx = p.x;
        lastSy = p.y;
      }
      mouse.on = true;
      if (opts.interactive && !opts.reducedMotion) wake();
    },
    { passive: true }
  );

  listen(leaveTarget, "pointerleave", () => {
    if (!mouse.on) return;
    mouse.on = false;
    // The rings under the pointer are the only thing leaving takes away, and
    // they can only be on screen if both of these were true when it arrived —
    // on touch, where a tap ends in a pointerleave, they never are.
    if (opts.interactive && !opts.reducedMotion) wake();
  });

  // Passive, and it matters more than it looks: passivity is fixed when the
  // listener is registered, so the early-out inside the handler cannot buy it
  // back. A non-passive pointerdown on window is a listener the browser has to
  // run and wait on before it can start compositing a touch scroll — on every
  // page of the site, for a handler that never calls preventDefault.
  listen(
    moveTarget,
    "pointerdown",
    (e) => {
      if (!opts.interactive || opts.reducedMotion) return;
      const el = e.target as Element | null;
      if (el && typeof el.closest === "function" && el.closest(NO_RIPPLE)) return;
      const p = toSurface(e as PointerEvent);
      if (ripples.length >= MAX_RIPPLES) ripples.shift();
      ripples.push({ x: p.x, y: p.y, t: 0 });
      wake();
    },
    { passive: true }
  );

  // The channel band is the only thing on the surface positioned in page space
  // rather than viewport space, so it is the only reason a scroll needs a frame
  // at all — and a frame here is the whole field, not a scroll of it. So the
  // wake has to earn itself: with the channel off, under reduced motion, on the
  // four pages that have no hero to taper against, and on every scroll after
  // the taper has left the viewport, the next frame would be the frame already
  // on screen and scrolling wakes nothing. A boxed host does not move with the
  // page either, so it gets no scroll listener.
  if (!host.events) {
    listen(
      view,
      "scroll",
      () => {
        if (!opts.channel || opts.reducedMotion || rafId) return;
        // `false`: the map has not moved, so the frame this schedules re-strokes
        // the contours it already has instead of re-running the noise for them.
        if (channelKey(host.heroBottom?.() ?? null) !== lastEdge) wake(false);
      },
      { passive: true }
    );
  }

  // rAF does not run in a hidden tab, so a returning tab comes back with a
  // stale clock and, if it went to sleep mid-motion, a half-finished frame.
  listen(doc, "visibilitychange", () => {
    if (!doc.hidden) wake();
  });

  /* ── handle ─────────────────────────────────────────────────────────── */

  resize();

  return {
    update(next: Partial<TerrainOptions>) {
      if (destroyed) return;
      const prevCell = opts.cell;
      opts = clampOptions(next, opts);
      // The grid pitch is the only option the allocation depends on, so it is
      // the only one that costs anything to change.
      if (opts.cell !== prevCell) allocGrid();
      if (opts.reducedMotion || !opts.interactive) {
        ripples.length = 0;
        if (opts.reducedMotion) flow = 0;
      }
      wake();
    },
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) view.cancelAnimationFrame(rafId);
      rafId = 0;
      for (const off of teardown) off();
      teardown.length = 0;
      ripples.length = 0;
      minorSegs.n = 0;
      minorSegs.xy = new Float32Array(0);
      majorSegs.n = 0;
      majorSegs.xy = new Float32Array(0);
      field = new Float32Array(0);
      chGrad = null;
    },
  };
}
