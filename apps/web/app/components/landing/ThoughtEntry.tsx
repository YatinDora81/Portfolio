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

/**
 * Weight is width. A word swelling 250 → 760 gets measurably wider, and on a
 * measure this tight that was enough to push the last word of a line down to
 * the next one — which carried it out from under the cursor, which shrank it
 * back, which pulled it up again, forever.
 *
 * Pinning every box to its resting width breaks the loop: the glyphs still
 * swell, they just do it inside a box that moves nothing. `.w-pin` is what lets
 * them — it stops the span wrapping at all, so the extra weight spills past the
 * box instead of folding the word onto a second line inside it, and centres the
 * spill so the word still grows around its own middle.
 *
 * Widths are read at BASE and any weight already on a span is put back, so this
 * is safe to re-run mid-hover — which a resize does.
 */
function pinWidths(quote: HTMLElement, spans: HTMLSpanElement[]) {
  const held = spans.map((el) => el.style.getPropertyValue('--w'));
  spans.forEach((el) => {
    el.classList.remove('w-pin');
    el.style.width = '';
    el.style.setProperty('--w', String(BASE));
  });

  // Measured before `.w-pin` lands, while the span can still wrap: one taller
  // than a line holds a long token already broken across two, and `.w-pin`
  // would only trap the overflow that break exists to avoid. Those stay fluid —
  // a token that long has no resting width worth holding on to anyway.
  const line = parseFloat(getComputedStyle(quote).lineHeight) || 0;
  const fits = spans.map((el) => line === 0 || el.offsetHeight <= line * 1.5);
  spans.forEach((el, i) => {
    if (fits[i]) el.classList.add('w-pin');
  });

  const widths = spans.map((el, i) => (fits[i] ? el.getBoundingClientRect().width : 0));
  spans.forEach((el, i) => {
    const width = widths[i]!;
    if (width > 0) el.style.width = `${width}px`;
    else el.classList.remove('w-pin');
    const weight = held[i];
    if (weight) el.style.setProperty('--w', weight);
    else el.style.removeProperty('--w');
  });
}

function unpinWidths(spans: HTMLSpanElement[]) {
  spans.forEach((el) => {
    el.classList.remove('w-pin');
    el.style.width = '';
  });
}

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

  /* Layout has to stop moving before the weights are allowed to — see
     pinWidths. Fonts first: pinned to a fallback face's metrics, every box
     would hold a width the real face never has. */
  useEffect(() => {
    const wrap = ref.current;
    const quote = wrap?.querySelector<HTMLElement>('.th-quote');
    if (!wrap || !quote || reduced) return;

    const spans = Array.from(wrap.querySelectorAll<HTMLSpanElement>('.w'));
    if (spans.length === 0) return;

    let mounted = true;
    let raf: number | null = null;
    let pinnedAt = -1;

    const pin = () => {
      raf = null;
      // A block with no box measures every word at zero, and pinning THAT
      // collapses the quote to a point. It gets another go the moment the
      // observer sees a width.
      const width = quote.clientWidth;
      if (!mounted || width === 0 || width === pinnedAt) return;
      pinnedAt = width;
      pinWidths(quote, spans);
    };
    // Resizes arrive in bursts and each pin costs two layout flushes.
    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(pin);
    };

    // The observer is both the width watch and the first measurement: it fires
    // once on observe, then whenever the column is a different size — a resize,
    // a zoom, or a block that had no box to start with.
    const ro = new ResizeObserver(schedule);
    ro.observe(quote);
    // A font landing rewrites every advance without moving the column an inch,
    // so that one has to ask for the re-measure the width gate would refuse.
    void document.fonts.ready.then(() => {
      pinnedAt = -1;
      schedule();
    });
    return () => {
      mounted = false;
      if (raf !== null) cancelAnimationFrame(raf);
      ro.disconnect();
      unpinWidths(spans);
    };
  }, [reduced]);

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
