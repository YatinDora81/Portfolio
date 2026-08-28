'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

export interface ScopeHandle {
  poke(k?: number): void;
  burst(): void;
}

const n1 = (x: number) =>
  Math.sin(x * 1.7) * 0.55 + Math.sin(x * 3.1 + 1.3) * 0.3 + Math.sin(x * 5.3 + 4.1) * 0.15;

const gauss = (x: number, mu: number, s: number) => Math.exp(-((x - mu) ** 2) / (2 * s * s));

const STATIC_T = 0.7;

const Scope = forwardRef<ScopeHandle, { caption: string }>(function Scope({ caption }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ampRef = useRef<HTMLSpanElement>(null);

  const energy = useRef(0);
  const mode = useRef<'idle' | 'burst'>('idle');
  const burstT0 = useRef(0);
  const txTimer = useRef<number | null>(null);

  const [txing, setTxing] = useState(false);
  const reduced = useReducedMotion() ?? false;
  // not once: the scope has to switch off again
  const inView = useInView(rootRef, { amount: 0 });

  useImperativeHandle(
    ref,
    () => ({
      poke(k = 0.22) {
        if (reduced) return;
        energy.current = Math.min(1, energy.current + k);
      },
      burst() {
        if (reduced) return;
        mode.current = 'burst';
        burstT0.current = performance.now();
        setTxing(true);
        if (txTimer.current !== null) window.clearTimeout(txTimer.current);
        txTimer.current = window.setTimeout(() => {
          txTimer.current = null;
          setTxing(false);
        }, 1550);
      },
    }),
    [reduced],
  );

  useEffect(
    () => () => {
      if (txTimer.current !== null) window.clearTimeout(txTimer.current);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const amp = ampRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const live = !reduced && inView;
    let W = 0;
    let H = 0;
    let fg = '#0a0a0a';
    let raf: number | null = null;

    const sampleY = (u: number, time: number) => {
      const mid = H / 2;
      if (mode.current === 'burst') {
        const el = (performance.now() - burstT0.current) / 1000;
        if (el < 0.32) {
          const a = 30 * (1 - el / 0.32);
          return mid + n1(u * 26 + time * 14) * a + Math.sin(u * 60 + time * 30) * a * 0.5;
        }
        if (el < 0.55) return mid;
        if (el < 1.5) {
          const p = (el - 0.55) / 0.95;
          const c1 = p * 1.15 - 0.06;
          const c2 = c1 - 0.1;
          const a = 34 * (1 - p * 0.35);
          return mid - (gauss(u, c1, 0.016) + gauss(u, c2, 0.016) * 0.7) * a;
        }
        mode.current = 'idle';
      }
      const base = 3.2 + Math.sin(time * 0.9) * 0.9;
      const a = base + energy.current * 30;
      const wob = n1(u * 9 + time * 2.4) * a;
      const fine = Math.sin(u * 46 + time * 9) * a * 0.22 * (0.3 + energy.current);
      return mid + wob + fine;
    };

    // arrow, not a declaration: keeps the ctx narrowing above
    const drawFrame = (time: number) => {
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = fg;
      ctx.globalAlpha = 0.28;
      ctx.setLineDash([1, 7]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const N = Math.max(140, Math.floor(W / 4));
      const pts: [number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        pts.push([u * W, sampleY(u, time)]);
      }
      const trace = () => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      };

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 5;
      trace();
      ctx.globalAlpha = 0.92;
      ctx.lineWidth = 1.6;
      trace();
      ctx.globalAlpha = 1;
    }

    const size = () => {
      const w = canvas.clientWidth;
      // content-visibility:auto means the canvas can measure 0
      if (!w) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = w;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const readColor = () => {
      fg = getComputedStyle(canvas).color || fg;
      if (!live) drawFrame(STATIC_T);
    };
    readColor();
    const theme = new MutationObserver(readColor);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const ro = new ResizeObserver(() => {
      if (size() && !live) drawFrame(STATIC_T);
    });
    ro.observe(canvas);

    if (live) {
      const loop = (now: number) => {
        energy.current *= 0.945;
        if (energy.current < 0.001) energy.current = 0;
        drawFrame(now / 1000);
        if (amp) {
          amp.textContent = `amp ${mode.current === 'burst' ? '••••' : energy.current.toFixed(2)}`;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else if (amp) {
      amp.textContent = 'amp 0.00';
    }

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      ro.disconnect();
      theme.disconnect();
    };
  }, [reduced, inView]);

  return (
    <div ref={rootRef} className={`scope${txing ? ' txing' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="scope-hud">
        <span>
          <b>sig</b> · live
        </span>
        <span className="tx">▲ transmitting</span>
        <span>
          <b>ch</b> 01 · direct
        </span>
      </div>
      <div className="scope-cap">
        <span>{caption}</span>
        <span ref={ampRef}>amp 0.00</span>
      </div>
    </div>
  );
});

export default Scope;
