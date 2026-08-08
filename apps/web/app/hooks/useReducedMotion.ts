'use client';

import { useSyncExternalStore } from 'react';

const query = () => window.matchMedia('(prefers-reduced-motion: reduce)');

/** Live `prefers-reduced-motion`. `false` on the server, so the markup React
    sends and the markup it hydrates against always agree. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = query();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => query().matches,
    () => false
  );
}
