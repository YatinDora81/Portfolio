'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

// 250→760 is most of Inter's wght range
const BASE = 250;
const PEAK = 760;
const RADIUS = 170;

const gauss = (x: number, mu: number, sigma: number) =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

function pinWidths(quote: HTMLElement, spans: HTMLSpanElement[]) {
  const held = spans.map((el) => el.style.getPropertyValue('--w'));
  spans.forEach((el) => {
    el.classList.remove('w-pin');
    el.style.width = '';
    el.style.setProperty('--w', String(BASE));
  });

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
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion() ?? false;

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
      const width = quote.clientWidth;
      if (!mounted || width === 0 || width === pinnedAt) return;
      pinnedAt = width;
      pinWidths(quote, spans);
    };
    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(pin);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(quote);
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
      words.forEach(({ el }) => el.style.setProperty('--w', '420'));
      return;
    }
    if (!window.matchMedia('(hover: hover)').matches) return;

    let raf: number | null = null;
    let measured = false;

    const measure = () => {
      words.forEach((word) => {
        const r = word.el.getBoundingClientRect();
        word.cx = r.left + r.width / 2;
        word.cy = r.top + r.height / 2;
      });
      measured = true;
    };

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

    // viewport coordinates, invalidated by anything that moves the block
    const stale = () => {
      measured = false;
    };

    quote.addEventListener('pointermove', onMove);
    quote.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', stale, { passive: true });
    window.addEventListener('scroll', stale, { passive: true });
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
