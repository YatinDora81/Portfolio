'use client';

/**
 * The thought section's only client code, split out so ThoughtOfTheDay stays a
 * server component and the day's quote never enters the client bundle. The word
 * spans arrive as server-rendered children and are read back out of the DOM.
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

/** The resting weight, the weight directly under the cursor, and how far the
    cursor's pull reaches in px. 250→760 is most of Inter's `wght` range, which
    is what makes the swell read as type rather than as a hover state. */
const BASE = 250;
const PEAK = 760;
const RADIUS = 170;

const gauss = (x: number, mu: number, sigma: number) =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

export default function ThoughtEntry({
  len,
  children,
}: {
  len: 'short' | 'long';
  children: ReactNode;
}) {
  // 0.4, not 0.1: the block is short, so a tenth of it is on screen while it is
  // still a sliver at the bottom edge and the ramp would play to nobody.
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion() ?? false;

  /* Pointer gravity: each word's weight springs toward the cursor. */
  useEffect(() => {
    const wrap = ref.current;
    const quote = wrap?.querySelector<HTMLElement>('.th-quote');
    if (!wrap || !quote) return;

    const words = Array.from(wrap.querySelectorAll<HTMLSpanElement>('.w')).map((el) => ({
      el,
      w: BASE,
      t: BASE,
      cx: 0,
      cy: 0,
    }));
    if (words.length === 0) return;

    if (reduced) {
      // One weight, once, and nothing to clean up. 420 rather than BASE so the
      // quote still reads as set type instead of as the thinnest thing on screen.
      words.forEach(({ el }) => el.style.setProperty('--w', '420'));
      return;
    }
    if (!window.matchMedia('(hover: hover)').matches) return;

    let raf: number | null = null;
    let measured = false;

    // Lazily, because the entrance is still translating the words when this
    // mounts and a centre measured mid-ramp is a centre for where they were.
    const measure = () => {
      words.forEach((word) => {
        const r = word.el.getBoundingClientRect();
        word.cx = r.left + r.width / 2;
        word.cy = r.top + r.height / 2;
      });
      measured = true;
    };

    // Written straight to the node — a pointermove must never re-render React.
    // The loop stops itself once every word has landed rather than idling at
    // 60fps over a paragraph nobody is pointing at.
    const step = () => {
      let live = false;
      words.forEach((word) => {
        word.w += (word.t - word.w) * 0.16;
        if (Math.abs(word.t - word.w) > 0.4) live = true;
        word.el.style.setProperty('--w', word.w.toFixed(1));
      });
      raf = live ? requestAnimationFrame(step) : null;
    };

    const onMove = (e: PointerEvent) => {
      if (!measured) measure();
      words.forEach((word) => {
        const d = Math.hypot(e.clientX - word.cx, e.clientY - word.cy);
        const k = Math.max(0, 1 - d / RADIUS);
        // Squared, so the falloff is a bulge around the cursor rather than a
        // cone that leaves the whole line half-bold.
        word.t = BASE + (PEAK - BASE) * k * k;
      });
      if (raf === null) raf = requestAnimationFrame(step);
    };

    const onLeave = () => {
      words.forEach((word) => {
        word.t = BASE;
      });
      if (raf === null) raf = requestAnimationFrame(step);
    };

    // Viewport coordinates, so anything that moves the block invalidates them.
    const stale = () => {
      measured = false;
    };

    quote.addEventListener('pointermove', onMove);
    quote.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', stale, { passive: true });
    window.addEventListener('scroll', stale, { passive: true });
    // The entrance moves the words too and fires no scroll/resize event, so a
    // pointer resting over the block as it ramps in would keep centres measured
    // mid-translate forever.
    quote.addEventListener('animationend', stale);
    return () => {
      quote.removeEventListener('pointermove', onMove);
      quote.removeEventListener('pointerleave', onLeave);
      quote.removeEventListener('animationend', stale);
      window.removeEventListener('resize', stale);
      window.removeEventListener('scroll', stale);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  /* Touch: no cursor to chase, so a weight pulse walks the line on its own and
     the type still breathes. Held until the word ramp has finished — starting
     mid-entrance fights the animation for the same property. */
  useEffect(() => {
    const wrap = ref.current;
    if (!wrap || !inView || reduced) return;
    if (window.matchMedia('(hover: hover)').matches) return;

    const spans = Array.from(wrap.querySelectorAll<HTMLSpanElement>('.w'));
    if (spans.length === 0) return;

    let head = -3;
    let dir = 1;
    let raf: number | null = null;

    const pulse = () => {
      head += 0.14 * dir;
      // Overruns both ends so the turnaround happens off the line, not on the
      // first and last word.
      if (head > spans.length + 3 || head < -3) dir *= -1;
      spans.forEach((el, i) => {
        el.style.setProperty('--w', (BASE + (620 - BASE) * gauss(i, head, 1.6)).toFixed(1));
      });
      raf = requestAnimationFrame(pulse);
    };

    const start = setTimeout(
      () => {
        raf = requestAnimationFrame(pulse);
      },
      spans.length * 45 + 750
    );
    return () => {
      clearTimeout(start);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [inView, reduced]);

  return (
    <div ref={ref} className={`th-wrap${inView ? ' in' : ''}`} data-len={len}>
      {children}
    </div>
  );
}
