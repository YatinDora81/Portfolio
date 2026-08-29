'use client';

import { useEffect, useRef } from 'react';

const GLYPHS = '-_·/\\|=+<>[]{}#%';
const KEEP = new Set([' ', '—', '-', '.']);
const DURATION_MS = 320;

export default function DecodeLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let lockTimer = 0;
    const chars = Array.from(text);

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / DURATION_MS);
          const settled = Math.floor(p * chars.length);
          el.textContent = chars
            .map((c, i) =>
              i < settled || KEEP.has(c)
                ? c
                : (GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? c),
            )
            .join('');
          if (p < 1) {
            raf = requestAnimationFrame(tick);
            return;
          }
          el.textContent = text;
          el.classList.add('locked');
          lockTimer = window.setTimeout(() => el.classList.remove('locked'), 700);
        };
        raf = requestAnimationFrame(tick);
      },
      { rootMargin: '-40px 0px' },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(lockTimer);
      el.textContent = text;
      el.classList.remove('locked');
    };
  }, [text]);

  return (
    <span ref={ref} className="decode">
      {text}
    </span>
  );
}
