'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { SECTIONS } from '@/lib/sections';
import { optedOut, readAttribution, sendEvents, type CollectEvent } from '@/lib/analytics-beacon';

const MIN_MS = 300;
const MAX_MS = 300_000;

type Dwell = { start: number | null; total: number; reached: boolean };

export function useSectionDwell(enabled: boolean): void {
  const pathname = usePathname();
  const dwell = useRef<Map<string, Dwell>>(new Map());
  const flushed = useRef(false);

  useEffect(() => {
    if (!enabled || optedOut()) return;

    // 🚨 Observe the `<section>` itself, never a child: these ids carry
    // content-visibility:auto, and a container skipping its contents suppresses
    // IntersectionObserver for everything beneath it.
    const targets: HTMLElement[] = [];
    for (const id of SECTIONS) {
      const el = document.getElementById(id);
      if (el) targets.push(el);
    }
    if (targets.length === 0) return;

    const states = dwell.current;
    states.clear();
    for (const el of targets) states.set(el.id, { start: null, total: 0, reached: false });

    const bank = () => {
      const now = performance.now();
      for (const state of states.values()) {
        if (state.start === null) continue;
        state.total += now - state.start;
        state.start = null;
      }
    };

    // Banked time is consumed on send, so the visibility flush and the pagehide
    // flush cannot report the same milliseconds twice.
    const flush = () => {
      bank();
      const events: CollectEvent[] = [];
      for (const [section, state] of states) {
        if (!state.reached || state.total < MIN_MS) continue;
        events.push({
          type: 'SECTION_DWELL',
          path: pathname,
          section,
          durationMs: Math.min(Math.round(state.total), MAX_MS),
        });
        state.total = 0;
      }
      if (events.length === 0) return;
      sendEvents(
        events,
        readAttribution() ?? { referrer: null, landingPath: window.location.pathname }
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const now = performance.now();
        for (const entry of entries) {
          const state = states.get(entry.target.id);
          if (!state) continue;
          if (entry.isIntersecting) {
            state.reached = true;
            if (state.start === null) state.start = now;
          } else if (state.start !== null) {
            state.total += now - state.start;
            state.start = null;
          }
        }
      },
      // 🚨 A centre band, not a percentage threshold: a section taller than the
      // viewport never occupies 50% of it and would record zero forever.
      { rootMargin: '-40% 0px -40% 0px', threshold: 0 }
    );

    const observeAll = () => {
      for (const el of targets) observer.observe(el);
    };
    observeAll();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush();
        return;
      }
      // Re-observing re-fires only for what is genuinely on screen now. Blindly
      // restarting the parked timers would resume sections the visitor scrolled
      // past while the tab was hidden.
      observer.disconnect();
      observeAll();
    };

    // pagehide, not beforeunload: mobile Safari skips beforeunload, which would
    // lose exactly the visitors most likely to bounce.
    const onPageHide = () => {
      if (flushed.current) return;
      flushed.current = true;
      flush();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      observer.disconnect();
      flush();
    };
  }, [enabled, pathname]);
}
