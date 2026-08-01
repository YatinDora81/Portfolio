'use client';

/**
 * Carrier — the address riding its own wave.
 *
 * A pulse of weight walks through the letters like current down a wire, and the
 * rule under them is not a border but a live carrier signal: it lifts when the
 * pointer arrives and breaks into a burst → flatline → double-pulse ACK the
 * moment the address is copied. The whole strip is one button, because on a line
 * this wide the run past the end of the address is the largest target here.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import type { ScopeHandle } from './Scope';

interface CarrierProps {
  email: string;
  scope: RefObject<ScopeHandle | null>;
}

/** The weight the letters rest at, and the peak the ripple carries through them. */
const CBASE = 460;
const CPEAK = 800;

const gauss = (x: number, mu: number, s: number) => Math.exp(-((x - mu) ** 2) / (2 * s * s));

/** Three sines, no RNG: the wave is the same shape on every machine and on every
    reload, so nothing here needs seeding. */
const noise = (x: number) =>
  Math.sin(x * 1.9) * 0.6 + Math.sin(x * 3.7 + 1.1) * 0.28 + Math.sin(x * 6.1 + 3.7) * 0.12;

function CopyMark() {
  return (
    <svg className="ic-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg className="ic-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function Carrier({ email, scope }: CarrierProps) {
  // Guarding here rather than inside CarrierLine keeps every hook unconditional.
  // No address means no block at all: a button that copies "" and a mailto:
  // pointing nowhere are both worse than an absent line.
  if (!email) return null;
  return <CarrierLine email={email} scope={scope} />;
}

function CarrierLine({ email, scope }: CarrierProps) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Shared between the two loops below and written by pointer handlers, so a
  // hover never re-renders React.
  const hovering = useRef(false);
  /** performance.now() of the last copy; 0 while the wave is idling. */
  const burstAt = useRef(0);

  // Not `once`: an oscilloscope four screens above the fold must not burn a
  // frame budget, so both loops stop again when the section leaves.
  const inView = useInView(rootRef, { amount: 0 });

  // A counter rather than a flag — copying again while the check is showing has
  // to restart the 2000ms window, and setting `true` over `true` re-renders
  // nothing and so never re-runs the timer below.
  const [copies, setCopies] = useState(0);
  const copied = copies > 0;

  useEffect(() => {
    if (!copies) return;
    const id = window.setTimeout(() => setCopies(0), 2000);
    return () => window.clearTimeout(id);
  }, [copies]);

  const chars = Array.from(email);
  const n = chars.length;

  /* the ripple through the letters */
  useEffect(() => {
    const addr = addrRef.current;
    const btn = btnRef.current;
    if (!addr || !btn) return;

    const spans = Array.from(addr.querySelectorAll<HTMLElement>('.cc'));

    if (reduced) {
      // One weight, a shade above rest, and no loop to clean up.
      spans.forEach((s) => s.style.setProperty('--cw', '520'));
      return;
    }

    const hoverable = window.matchMedia('(hover: hover)').matches;
    let head = -4;
    let raf: number | null = null;

    const frame = () => {
      head += hovering.current ? 0.55 : 0.22;
      if (head > n + 4) head = -4;
      let live = false;
      spans.forEach((s, i) => {
        const k = gauss(i, head, 2.1);
        s.style.setProperty('--cw', (CBASE + (CPEAK - CBASE) * k).toFixed(0));
        s.style.setProperty('--cy', (-2.2 * k).toFixed(2));
        if (k > 0.01) live = true;
      });
      // Runs on past pointerleave until the pulse has walked off the end —
      // stopping on the leave itself would freeze the letters mid-swell.
      raf = hovering.current || !hoverable || live ? requestAnimationFrame(frame) : null;
    };

    if (!hoverable) {
      // No cursor to chase, so the ripple drifts on its own.
      if (inView) raf = requestAnimationFrame(frame);
      return () => {
        if (raf !== null) cancelAnimationFrame(raf);
      };
    }

    const enter = () => {
      hovering.current = true;
      if (raf === null) {
        head = -4;
        raf = requestAnimationFrame(frame);
      }
    };
    const leave = () => {
      hovering.current = false;
    };
    btn.addEventListener('pointerenter', enter);
    btn.addEventListener('pointerleave', leave);
    return () => {
      btn.removeEventListener('pointerenter', enter);
      btn.removeEventListener('pointerleave', leave);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [n, reduced, inView]);

  /* the mini wave that doubles as the underline */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !inView) return;

    const hoverable = window.matchMedia('(hover: hover)').matches;
    let w = 0;
    let h = 0;
    let hoverAmt = 0;
    let raf: number | null = null;
    let ink = '#fafafa';

    // The canvas inherits currentColor, so its own computed colour is the ink —
    // reading document.body's would miss anything the section re-colours.
    const readInk = () => {
      ink = getComputedStyle(canvas).color.trim() || ink;
    };
    readInk();

    const size = () => {
      // #contact carries content-visibility:auto: while the section is skipped
      // the canvas measures 0 and every frame drawn into it is thrown away.
      if (!canvas.clientWidth) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const sampleY = (u: number, time: number) => {
      const mid = h * 0.5;
      if (burstAt.current) {
        const el = (performance.now() - burstAt.current) / 1000;
        if (el < 0.24) {
          const a = 11 * (1 - el / 0.24);
          return mid + noise(u * 30 + time * 16) * a;
        }
        if (el < 0.42) return mid; // flatline — the address has left
        if (el < 1.25) {
          // double-pulse ACK, travelling left → right
          const p = (el - 0.42) / 0.83;
          const c1 = p * 1.12 - 0.05;
          return mid - (gauss(u, c1, 0.015) + gauss(u, c1 - 0.09, 0.015) * 0.7) * 12;
        }
        burstAt.current = 0;
      }
      const amp = 1.4 + hoverAmt * 5.2 + Math.sin(time * 0.8) * 0.5;
      return mid + noise(u * 7 + time * 1.9) * amp + Math.sin(u * 40 + time * 8) * amp * 0.2;
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      const pts: [number, number][] = [];
      const steps = Math.max(120, Math.floor(w / 5));
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        pts.push([u * w, sampleY(u, time)]);
      }
      const trace = () => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      };
      ctx.strokeStyle = ink;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Wide and dim first for the phosphor bloom, then the core stroke over it.
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 4;
      trace();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.4;
      trace();
      ctx.globalAlpha = 1;
    };

    // Sizing from an observer, not a one-shot read: the first measurement of a
    // skipped section is 0, and only the observer hears the real one arrive.
    const box = new ResizeObserver(() => {
      // Resizing the bitmap clears it, so the one static frame has to be laid
      // down again each time.
      if (size() && reduced) draw(0.6);
    });
    box.observe(canvas);

    const theme = new MutationObserver(() => {
      readInk();
      if (reduced && w) draw(0.6);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    if (!reduced) {
      const loop = (now: number) => {
        hoverAmt += ((hoverable ? (hovering.current ? 1 : 0) : 0.35) - hoverAmt) * 0.08;
        if (w) draw(now / 1000);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      box.disconnect();
      theme.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [reduced, inView]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      // No clipboard permission (or no clipboard at all) — the address is on
      // screen and selectable either way, and ↗ still opens a mail client.
    }
    setCopies((c) => c + 1);
    if (!reduced) burstAt.current = performance.now();
    scope.current?.poke(0.3);
  };

  return (
    <div className="carrier" ref={rootRef}>
      <div className="lab">
        <span>carrier &mdash; email</span>
        <i aria-hidden="true" />
        <span className={`car-copied mono${copied ? ' on' : ''}`} aria-hidden="true">
          copied ✓
        </span>
      </div>

      <button
        className={`car-btn${copied ? ' copied' : ''}`}
        type="button"
        ref={btnRef}
        onClick={copy}
        aria-label={copied ? `Copied ${email}` : `Copy email address ${email}`}
        title="Copy email address"
      >
        <span className="car-top">
          {/* The per-character spans are hidden and the address is repeated once
              below them: a screen reader handed 21 spans reads it one letter at
              a time. */}
          <span className="car-addr" ref={addrRef} aria-hidden="true">
            {chars.map((ch, i) => (
              // Positional and never reordered — the ripple indexes by position.
              <span key={i} className={ch === '@' ? 'cc at' : 'cc'}>
                {ch}
              </span>
            ))}
          </span>
          <span className="sr-only">{email}</span>
          <span className="car-ic" aria-hidden="true">
            <CopyMark />
            <CheckMark />
          </span>
        </span>
        {/* the wave IS the underline */}
        <canvas className="car-wave" ref={canvasRef} aria-hidden="true" />
      </button>

      <div className="car-sub">
        <a className="car-open" href={`mailto:${email}`}>
          open in mail ↗
        </a>
      </div>

      {/* Always mounted and empty at rest — a live region that is populated and
          then unhidden does not reliably announce. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Email copied to clipboard' : ''}
      </span>
    </div>
  );
}
