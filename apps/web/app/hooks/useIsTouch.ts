'use client';

import { useSyncExternalStore } from 'react';

const query = () => window.matchMedia('(hover: none)');

/** True where there is no cursor to chase. Hybrid laptops report `hover: hover`
    and count as pointer devices, which is the answer hover effects want. */
export function useIsTouch(): boolean {
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
