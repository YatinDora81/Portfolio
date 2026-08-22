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

    // Observe the `<section>` itself: content-visibility:auto suppresses IntersectionObserver for its children.
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
      // A centre band, not a percentage threshold: a section taller than the viewport never hits one.
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
      // Re-observing re-fires only for what is on screen now; restarting the parked timers would not.
      observer.disconnect();
      observeAll();
    };

    // pagehide, not beforeunload: mobile Safari skips beforeunload.
    const onPageHide = (event: PageTransitionEvent) => {
      if (flushed.current) return;
      // Only latch when the page is really going away. A bfcache-persisted page
      // comes back without remounting, so latching here would silently drop
      // every later flush in that tab.
      if (event.persisted !== true) flushed.current = true;
      flush();
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      flushed.current = false;
      observer.disconnect();
      observeAll();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      observer.disconnect();
      flush();
    };
  }, [enabled, pathname]);
}
