'use client';

import { LazyMotion } from 'motion/react';

// domAnimation, not domMax: domMax adds ~110 kB and a projection node per element
const loadFeatures = () => import('motion/react').then((mod) => mod.domAnimation);

export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
