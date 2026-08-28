'use client';

import { useSyncExternalStore } from 'react';

const query = () => window.matchMedia('(prefers-reduced-motion: reduce)');

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
