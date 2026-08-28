export interface TerrainOptions {
  strength: number;
  cell: number;
  levels: number;
  minor: number;
  major: number;
  interactive: boolean;
  channel: boolean;
  reducedMotion: boolean;
}

export interface TerrainHost {
  canvas: HTMLCanvasElement;
  ink: () => [number, number, number];
  dark: () => boolean;
  size: () => { w: number; h: number };
  heroBottom?: () => number | null;
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

const DPR_CAP = 1.5;

const DRAW_IN_MS = 1400;

const RIPPLE_LIFE = 2.2; // seconds
const RIPPLE_SPEED = 300; // px/s the ring front travels
const RIPPLE_BAND = 70;

const MAX_RIPPLES = 6;

const NOISE_S = 0.0066;
const PRESS = 0.62;
const PRESS_R2 = 52900;
const PRESS_FALLOFF = 15000;

const CH_INNER = 360;
const CH_OUTER = 450;
const CH_FEATHER = 140;
const CH_DARK = { hero: 0.8, body: 0.92 };
const CH_LIGHT = { hero: 0.9, body: 0.95 };

const CH_WAKE_SLACK = 300;

const CELL_MIN = 8;
const CELL_MAX = 28;
const LEVELS_MIN = 4;
const LEVELS_MAX = 24;

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

const MS_EDGES = new Int8Array([
  -1, -1, -1, -1,
  3, 2, -1, -1,
  2, 1, -1, -1,
  3, 1, -1, -1,
  0, 1, -1, -1,
  0, 1, 2, 3,
  0, 2, -1, -1,
  0, 3, -1, -1,
  0, 3, -1, -1,
  0, 2, -1, -1,
  0, 3, 1, 2,
  0, 1, -1, -1,
  3, 1, -1, -1,
  1, 2, -1, -1,
  3, 2, -1, -1,
  -1, -1, -1, -1,
]);
const MS_COUNT = new Int8Array([0, 2, 2, 2, 2, 4, 2, 2, 2, 2, 4, 2, 2, 2, 2, 0]);

function num(value: number, lo: number, hi: number, fallback: number): number {
  const n = Number.isFinite(value) ? value : fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

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

const NO_RIPPLE = "a,button,input,textarea,select,summary,[role='button'],[contenteditable]";

interface Segs {
  xy: Float32Array;
  n: number;
}

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

export function createTerrain(host: TerrainHost, options: TerrainOptions): TerrainHandle {
  const canvas = host.canvas;
  const ctx = canvas.getContext("2d");
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;

  if (!ctx || !win) {
    return { update: () => {}, resize: () => {}, destroy: () => {} };
  }

  const g: CanvasRenderingContext2D = ctx;
  const view: Window & typeof globalThis = win;

  let opts = clampOptions(options, TERRAIN_DEFAULTS);
  let destroyed = false;

  let W = 1;
  let H = 1;

  let field = new Float32Array(0);
  let gw = 0;
  let gh = 0;

  let time = 4.2;
  let flow = opts.reducedMotion ? 0 : 0.22;
  const ripples: { x: number; y: number; t: number }[] = [];
  let born = -1;
  let pressMoving = false;

  const mouse = { x: -9e3, y: -9e3, sx: -9e3, sy: -9e3, on: false, vx: 0, vy: 0 };
  let lastSx = mouse.sx;
  let lastSy = mouse.sy;

  let rafId = 0;
  let lastNow = 0;
  let appliedDpr = 0;

  let fieldDirty = true;

  let chGrad: CanvasGradient | null = null;
  let chGradW = 0;
  let lastEdge = Number.NaN;

  const minorSegs: Segs = { xy: new Float32Array(4096), n: 0 };
  const majorSegs: Segs = { xy: new Float32Array(4096), n: 0 };
  const ex = new Float64Array(4);
  const ey = new Float64Array(4);

  const active = () => flow > 0.003 || ripples.length > 0 || pressMoving;

  function wake(field = true): void {
    if (field) fieldDirty = true;
    if (destroyed || rafId) return;
    lastNow = view.performance.now();
    rafId = view.requestAnimationFrame(loop);
  }

  function loop(now: number): void {
    rafId = 0;
    if (destroyed) return;

    const dt = Math.min(0.05, Math.max(0.004, (now - lastNow) / 1000 || 0.016));
    lastNow = now;

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
      fieldDirty = true;
      rafId = view.requestAnimationFrame(loop);
    }
  }

  function drawFrame(dt: number, now: number): void {
    const cell = opts.cell;
    const L = opts.levels;
    const reduced = opts.reducedMotion;
    const live = mouse.on && opts.interactive && !reduced;

    if (born < 0) born = now;
    const fadeIn = reduced ? 1 : Math.min(1, (now - born) / DRAW_IN_MS);

    const speed = live ? Math.hypot(mouse.vx, mouse.vy) : 0;
    flow += (Math.min(1.4, speed * 0.0016) - flow) * (speed > 0 ? 0.12 : 0.06);
    if (reduced) flow = 0;
    time += flow * dt;

    pressMoving = Math.abs(mouse.sx - lastSx) + Math.abs(mouse.sy - lastSy) > 0.4;
    lastSx = mouse.sx;
    lastSy = mouse.sy;

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

    if (fadeIn < 1) pressMoving = true;
  }

  function marchContours(f: Float32Array, cell: number, L: number): void {
    minorSegs.n = 0;
    majorSegs.n = 0;

    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const a = f[j * gw + i]!;
        const b = f[j * gw + i + 1]!;
        const c = f[(j + 1) * gw + i + 1]!;
        const d = f[(j + 1) * gw + i]!;

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
    g.strokeStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${alpha})`;
    g.beginPath();
    const xy = segs.xy;
    for (let i = 0; i < segs.n; i += 4) {
      g.moveTo(xy[i]!, xy[i + 1]!);
      g.lineTo(xy[i + 2]!, xy[i + 3]!);
    }
    g.stroke();
  }

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

    let edge: number | null = null;
    if (!opts.reducedMotion && host.heroBottom) edge = host.heroBottom();
    lastEdge = channelKey(edge);

    g.globalCompositeOperation = "destination-out";
    g.fillStyle = gradient;

    if (edge === null) {
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

  function allocGrid(): void {
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

    if (w === W && h === H && dpr === appliedDpr) return;

    W = w;
    H = h;
    appliedDpr = dpr;

    // writing width/height resets the 2d state, transform included
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    chGrad = null;
    allocGrid();
    wake();
  }

  const pt = { x: 0, y: 0 };

  function toSurface(e: PointerEvent): { x: number; y: number } {
    if (!host.events) {
      pt.x = e.clientX;
      pt.y = e.clientY;
      return pt;
    }
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
    if (opts.interactive && !opts.reducedMotion) wake();
  });

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

  if (!host.events) {
    listen(
      view,
      "scroll",
      () => {
        if (!opts.channel || opts.reducedMotion || rafId) return;
        if (channelKey(host.heroBottom?.() ?? null) !== lastEdge) wake(false);
      },
      { passive: true }
    );
  }

  listen(doc, "visibilitychange", () => {
    if (!doc.hidden) wake();
  });

  resize();

  return {
    update(next: Partial<TerrainOptions>) {
      if (destroyed) return;
      const prevCell = opts.cell;
      opts = clampOptions(next, opts);
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
