'use client';

import { LazyMotion } from 'motion/react';

// Load Motion's feature set asynchronously, after hydration, so it stays out of
// the critical first-load JS. Components use the lightweight `m` component
// (imported as `m as motion`, so their JSX is unchanged) instead of the full
// `motion` component, which would eagerly bundle every feature.
//
// We use domMax (rather than the lighter domAnimation) because the navbar relies
// on a `layoutId` shared-layout animation, which lives in the max feature set.
// Either way the features are code-split into their own chunk by this dynamic
// import, so the critical bundle only pays for `m` + LazyMotion.
const loadFeatures = () => import('motion/react').then((mod) => mod.domMax);

export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
