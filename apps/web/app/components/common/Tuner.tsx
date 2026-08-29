'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const CHANNELS = [
  { id: 'about', label: 'about' },
  { id: 'skills', label: 'skills' },
  { id: 'experience', label: 'xp' },
  { id: 'projects', label: 'builds' },
  { id: 'blogs', label: 'writing' },
  { id: 'contact', label: 'contact' },
] as const;

const SHOW_AFTER_PX = 320;
const NAV_OFFSET_PX = 96;

interface Stop {
  id: string;
  label: string;
  n: string;
  y: number;
}

export default function Tuner({ sections }: { sections: Record<string, boolean> }) {
  const reduce = useReducedMotion();
  const railRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const roRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);

  const [stops, setStops] = useState<Stop[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [on, setOn] = useState(false);

  const layout = useCallback(() => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    if (total <= 0) return;
    const next: Stop[] = [];
    CHANNELS.forEach((c, i) => {
      if (sections[c.id] === false) return;
      const el = document.getElementById(c.id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET_PX;
      next.push({
        id: c.id,
        label: c.label,
        n: String(i + 1).padStart(2, '0'),
        y: Math.min(1, Math.max(0, top / total)),
      });
    });
    setStops(next);
  }, [sections]);

  useEffect(() => {
    if (!window.matchMedia('(min-width: 1100px)').matches) return;

    layout();

    let raf = 0;
    let wasOn = false;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const total = document.documentElement.scrollHeight - window.innerHeight;
        const p = total > 0 ? window.scrollY / total : 0;
        railRef.current?.style.setProperty('--p', p.toFixed(4));
        if (roRef.current) roRef.current.textContent = `${String(Math.round(p * 100)).padStart(2, '0')}%`;
        const nowOn = window.scrollY > SHOW_AFTER_PX;
        if (nowOn !== wasOn) {
          wasOn = nowOn;
          setOn(nowOn);
        }
      });
    };
    onScroll();

    const ro = new ResizeObserver(layout);
    ro.observe(document.body);

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setCur(en.target.id);
        });
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    CHANNELS.forEach((c) => {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', layout);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', layout);
      ro.disconnect();
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [layout]);

  const scrubTo = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const r = track.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    window.scrollTo({ top: p * (document.documentElement.scrollHeight - window.innerHeight), behavior: 'auto' });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.tune-stop')) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) scrubTo(e.clientY);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <aside ref={railRef} className={`tune mono${on ? ' on' : ''}`} aria-label="Section tuner" inert={!on}>
      <span ref={roRef} className="tune-ro" aria-hidden="true">
        00%
      </span>
      <div
        ref={trackRef}
        className="tune-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {Array.from({ length: 15 }, (_, i) => (
          <span key={i} className="tune-minor" style={{ top: `${((i + 1) / 16) * 100}%` }} aria-hidden="true" />
        ))}
        {stops.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`tune-stop${cur === s.id ? ' cur' : ''}`}
            style={{ top: `${s.y * 100}%` }}
            onClick={() =>
              document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
            }
          >
            <span>
              <b>{s.n}</b> {s.label}
            </span>
            <i aria-hidden="true" />
          </button>
        ))}
        <span className="tune-needle" aria-hidden="true" />
      </div>
    </aside>
  );
}
