'use client';

import { useEffect, useRef, useState } from 'react';
import { createTerrain, type TerrainHandle } from '@repo/ui/terrain';

export interface BackgroundTerrainProps {
  strength: number;
  veil: number;
  cell: number;
  levels: number;
  minor: number;
  major: number;
  channel: boolean;
  interactive: boolean;
}

const DARK_INK: [number, number, number] = [250, 250, 250];
const LIGHT_INK: [number, number, number] = [10, 10, 10];

// matches the beam cutoff in globals.css
const NARROW = '(max-width: 1024px)';

function parseInk(raw: string, dark: boolean): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return dark ? DARK_INK : LIGHT_INK;
  const h = m[1]!;
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export default function BackgroundTerrain({
  strength,
  veil,
  cell,
  levels,
  minor,
  major,
  channel,
  interactive,
}: BackgroundTerrainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<TerrainHandle | null>(null);

  const settings = useRef({ strength, cell, levels, minor, major, channel, interactive });

  // false on the server so hydration matches
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || narrow || window.matchMedia(NARROW).matches) return;

    const root = document.documentElement;

    let ink = DARK_INK;
    let dark = true;
    const readTheme = () => {
      dark = root.classList.contains('dark');
      ink = parseInk(getComputedStyle(root).getPropertyValue('--foreground'), dark);
    };
    readTheme();

    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const hero = document.getElementById('hero');

    // measuring forces layout, so cache it here
    let heroEdge = 0;
    let scrolled = window.scrollY;
    const measureHero = () => {
      if (hero) heroEdge = hero.getBoundingClientRect().bottom + window.scrollY;
    };
    measureHero();

    const handle = createTerrain(
      {
        canvas,
        ink: () => ink,
        dark: () => dark,
        size: () => ({ w: root.clientWidth, h: root.clientHeight }),
        heroBottom: hero ? () => heroEdge - scrolled : () => null,
      },
      { ...settings.current, reducedMotion: motionMq.matches }
    );
    handleRef.current = handle;

    let heroSize: ResizeObserver | null = null;
    if (hero) {
      heroSize = new ResizeObserver(measureHero);
      heroSize.observe(hero);
    }

    const themes = new MutationObserver(() => {
      if (root.classList.contains('dark') === dark) return;
      readTheme();
      handle.update({});
    });
    themes.observe(root, { attributes: true, attributeFilter: ['class'] });

    const onScroll = () => {
      scrolled = window.scrollY;
    };
    const onResize = () => {
      measureHero();
      handle.resize();
    };
    const onGate = () => handle.update({ reducedMotion: motionMq.matches });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    motionMq.addEventListener('change', onGate);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      motionMq.removeEventListener('change', onGate);
      heroSize?.disconnect();
      themes.disconnect();
      handle.destroy();
      handleRef.current = null;
    };
  }, [narrow]);

  useEffect(() => {
    settings.current = { strength, cell, levels, minor, major, channel, interactive };
    handleRef.current?.update(settings.current);
  }, [strength, cell, levels, minor, major, channel, interactive]);

  return (
    <>
      {narrow ? null : (
        <canvas
          ref={canvasRef}
          className="pointer-events-none fixed inset-0 z-0"
          aria-hidden="true"
        />
      )}

      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          backgroundColor: `color-mix(in srgb, var(--background) ${Math.round(veil * 100)}%, transparent)`,
        }}
      />
    </>
  );
}
