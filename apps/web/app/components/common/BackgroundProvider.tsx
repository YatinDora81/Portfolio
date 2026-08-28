'use client';

import { createContext, useContext } from 'react';
import type { SiteBackground } from '../../lib/data';

const V1: SiteBackground = {
  version: 'v1',
  strength: 0.5,
  veil: 0.5,
  cell: 12,
  levels: 14,
  minor: 0.2,
  major: 0.48,
  channel: true,
  interactive: true,
};

const BackgroundContext = createContext<SiteBackground>(V1);

export function useBackground() {
  return useContext(BackgroundContext);
}

export function BackgroundProvider({
  value,
  children,
}: {
  value: SiteBackground;
  children: React.ReactNode;
}) {
  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}
