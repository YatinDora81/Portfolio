'use client';

import { useEffect, useRef, useState } from 'react';
import { createTerrain, type TerrainHandle } from '@repo/ui/terrain';

export interface BackgroundTerrainProps {
  /** Master line-opacity multiplier, 0..1. */
  strength: number;
  /** The veil over the canvas, 0..1 of --background. */
  veil: number;
  cell: number;
  levels: number;
  /** Minor contour alpha, 0..1. */
  minor: number;
  /** Major contour alpha, 0..1. */
  major: number;
  channel: boolean;
  interactive: boolean;
}

const DARK_INK: [number, number, number] = [250, 250, 250];
const LIGHT_INK: [number, number, number] = [10, 10, 10];

/** The same line BackgroundLines' beams stop at (globals.css), for the reasons in the gate below. */
const NARROW = '(max-width: 1024px)';

/**
 * `--foreground` is a hex literal in both themes (globals.css), and the engine
 * strokes with channels rather than a CSS string, so it is parsed here once per
 * theme instead of per frame. A token rewritten as anything but hex falls back
 * to that theme's own ink: the wrong shade is a blemish, whereas defaulting to
 * 0,0,0 would paint a black map onto the black ground and read as a dead
 * feature.
 */
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

  // What the engine is built with. It is built once and told about every change
  // after that (the last effect below): tearing it down and rebuilding would
  // restart the 1.4s draw-in on every tick of an admin slider, and reallocate
  // the field grid to say the same thing. Kept current rather than frozen at
  // mount, because the width gate below can rebuild it — off a mount-time
  // snapshot a rotated tablet would come back at settings the page no longer
  // has.
  const settings = useRef({ strength, cell, levels, minor, major, channel, interactive });

  // False on the server and on the first client render, so hydration finds the
  // same two nodes it left; the query answers a tick later.
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

    // Below the cutoff there is no canvas at all, rather than a canvas holding
    // still. `reducedMotion` alone does not buy quiet: it stops the loop
    // re-scheduling itself, but the engine still wakes one complete frame — the
    // whole noise field, then marching squares over it — on every scroll event,
    // because the channel's step is pinned to the hero in page space. A fling
    // is one map per frame on a phone's main thread. And nothing is lost by
    // leaving: the channel erase spans a fixed 900px, so under ~720 it covers
    // the surface and rubs out the map it just computed, whole.
    //
    // Both halves of the test are needed — `narrow` is a render behind on the
    // first commit, and the query is what stops a phone building an engine only
    // to destroy it on the next tick.
    if (!canvas || narrow || window.matchMedia(NARROW).matches) return;

    const root = document.documentElement;

    // The engine asks for the ink and the theme once per frame, so both are
    // cached here and only re-read when the theme actually flips. A
    // getComputedStyle inside ink() would be a style recalc on every frame of
    // every pointer sweep — the exact cost this background was built to avoid.
    let ink = DARK_INK;
    let dark = true;
    const readTheme = () => {
      dark = root.classList.contains('dark');
      ink = parseInk(getComputedStyle(root).getPropertyValue('--foreground'), dark);
    };
    readTheme();

    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Only the landing page has one; the blog, 404 and error pages hand back
    // null and get the body erase everywhere, which is the safe strength.
    const hero = document.getElementById('hero');

    // The hero's edge is the one thing on the surface positioned in page space,
    // so the engine reads it on every frame it draws — which is why it is
    // measured on the events that can move it and cached, never read per frame.
    // At rAF time layout is dirty (oneko and the hero's own peek deck both write
    // styles every tick), so a measurement there is a synchronous full-document
    // layout at 60Hz, under the one background whose whole claim is that it
    // costs nothing while you read.
    //
    // Page space off the rect and not `offsetTop`: the hero's offsetParent is
    // the `relative z-[2]` wrapper, so offsetTop is the document offset only for
    // as long as that wrapper starts at zero. Cached scroll for the same reason
    // as the rect — reading scrollY forces layout too, and the scroll steps run
    // before the frame callbacks, so the cache is never a frame behind.
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
        // Not the canvas's own box: resize() writes explicit pixel dimensions
        // onto the element, so measuring it back would pin the surface to
        // whatever it first reported. clientWidth rather than innerWidth,
        // because the canvas is `fixed inset-0` and that box stops at the
        // scrollbar innerWidth counts.
        size: () => ({ w: root.clientWidth, h: root.clientHeight }),
        heroBottom: hero ? () => heroEdge - scrolled : () => null,
      },
      { ...settings.current, reducedMotion: motionMq.matches }
    );
    handleRef.current = handle;

    // The photos and the font swap both change the hero's height after mount,
    // and a stale edge puts the channel's step through the middle of a
    // paragraph. Observer callbacks run after layout, so re-measuring there is
    // free; the window listener below covers everything above the hero moving
    // instead of the hero itself.
    let heroSize: ResizeObserver | null = null;
    if (hero) {
      heroSize = new ResizeObserver(measureHero);
      heroSize.observe(hero);
    }

    // A theme flip changes what the next frame paints with — and at rest there
    // is no next frame, because the loop stops rather than idles. `update({})`
    // changes no option and asks for exactly one repaint. Guarded on the class
    // actually meaning something: Hero toggles `no-peek` on <html>, and every
    // future flag parked there would otherwise buy a style recalc and a full
    // repaint to re-derive an ink that did not move.
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

  // `reducedMotion` is deliberately absent: it belongs to the gates above, and a
  // Partial that omits it leaves the engine's current value alone.
  useEffect(() => {
    settings.current = { strength, cell, levels, minor, major, channel, interactive };
    handleRef.current?.update(settings.current);
  }, [strength, cell, levels, minor, major, channel, interactive]);

  return (
    <>
      {/* Empty on the server and filled by the effect, so hydration has nothing
          to reconcile. inset-0 only pins the origin — the engine writes the
          pixel width and height itself, capped at 1.5 DPR. */}
      {narrow ? null : (
        <canvas
          ref={canvasRef}
          className="pointer-events-none fixed inset-0 z-0"
          aria-hidden="true"
        />
      )}
      {/* v1's veil, at the strength the admin chose instead of a hardcoded half.
          A colour with alpha and not `opacity`: an opacity below 1 on a
          full-viewport fixed div is a fullscreen composited layer for the whole
          session, which is the same bill the backdrop-blur here was removed
          over. It stays below the cutoff, where it is --background over
          --background and costs a paint of nothing, so the two branches keep the
          same shape. */}
      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          backgroundColor: `color-mix(in srgb, var(--background) ${Math.round(veil * 100)}%, transparent)`,
        }}
      />
    </>
  );
}
