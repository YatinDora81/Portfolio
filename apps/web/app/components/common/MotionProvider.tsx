'use client';

import { LazyMotion } from 'motion/react';

// Load Motion's feature set asynchronously, after hydration, so it stays out of
// the critical first-load JS. Components use the lightweight `m` component
// (imported as `m as motion`, so their JSX is unchanged) instead of the full
// `motion` component, which would eagerly bundle every feature.
//
// `domAnimation`, not `domMax`. The only consumer of the max set was the
// navbar's `layoutId` hover pill, and that is a CSS transform transition now
// (see resizable-navbar.tsx). domMax adds the projection/layout engine and
// drag — roughly 110 kB more script, and every `m.*` element on the page paid
// for a projection node at hydration whether or not it animated layout.
const loadFeatures = () => import('motion/react').then((mod) => mod.domAnimation);

export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
