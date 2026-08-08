'use client';

import { useEffect, type RefObject } from 'react';
import { useIsTouch } from './useIsTouch';
import { useReducedMotion } from './useReducedMotion';

/** Lean, as a fraction of the pointer's offset from the element's centre.
    Vertical travel reads as heavier than horizontal, so it gets more gain to
    cover the same fraction of a much shorter box. */
const PULL_X = 0.14;
const PULL_Y = 0.224;
/** Past this the button has stopped feeling attached to the pointer. */
const MAX = 7;

/** Stiff enough to feel taut, damped just short of critical so the release
    overshoots by a hair on its way home. */
const STIFFNESS = 0.24;
const DAMPING = 0.7;

const clamp = (value: number) => Math.max(-MAX, Math.min(MAX, value));

/**
 * The element leans toward the pointer while it is over it and springs back
 * when it leaves.
 *
 * The offset is written to the independent `translate` property, never to
 * `transform`: `transform` already belongs to the element's own hover and press
 * states, and `translate` composes ahead of it, so the lean stacks on top of
 * them instead of overwriting them. It also keeps the per-frame tracking out of
 * any `transition: transform` the element carries, which would otherwise smear
 * every frame into a 200ms lag.
 */
export function useMagnetic<T extends HTMLElement>(ref: RefObject<T | null>) {
  const reduceMotion = useReducedMotion();
  const isTouch = useIsTouch();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion || isTouch) return;

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let raf: number | null = null;

    const frame = () => {
      vx = (vx + (tx - x) * STIFFNESS) * DAMPING;
      vy = (vy + (ty - y) * STIFFNESS) * DAMPING;
      x += vx;
      y += vy;

      const settled =
        Math.abs(tx - x) < 0.05 &&
        Math.abs(ty - y) < 0.05 &&
        Math.abs(vx) < 0.05 &&
        Math.abs(vy) < 0.05;
      if (settled) {
        x = tx;
        y = ty;
        vx = 0;
        vy = 0;
      }

      // Home again: drop the declaration rather than parking a `0px 0px` on the
      // node, so an untouched button carries no inline style at all.
      if (settled && x === 0 && y === 0) el.style.removeProperty('translate');
      else el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;

      raf = settled ? null : requestAnimationFrame(frame);
    };

    const start = () => {
      if (raf === null) raf = requestAnimationFrame(frame);
    };

    const move = (event: PointerEvent) => {
      const r = el.getBoundingClientRect();
      // The rect travels with the lean, so back out what is already applied —
      // measured from the moved box, the pull compounds and the button chases
      // its own offset.
      const cx = r.left + r.width / 2 - x;
      const cy = r.top + r.height / 2 - y;
      tx = clamp((event.clientX - cx) * PULL_X);
      ty = clamp((event.clientY - cy) * PULL_Y);
      start();
    };

    const release = () => {
      tx = 0;
      ty = 0;
      start();
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', release);
      el.removeEventListener('pointercancel', release);
      if (raf !== null) cancelAnimationFrame(raf);
      el.style.removeProperty('translate');
    };
  }, [ref, reduceMotion, isTouch]);
}
