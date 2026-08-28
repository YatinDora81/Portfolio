'use client';

import { createContext, useContext } from 'react';
import type { SiteBackground } from '../../lib/data';

/**
 * v1 at the numbers the site has always drawn. This is the context default, not
 * a fallback nobody reaches: `app/error.tsx` renders when a page threw, and the
 * page that threw may have been the one carrying the provider. A consumer that
 * finds no provider draws the background it would have had anyway, which is the
 * only version of "the error page is broken too" worth shipping.
 */
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

/**
 * The layout already awaits `getSiteConfig()`, so the resolved, clamped config
 * comes down as a prop and is handed straight to the context — no state, no
 * effect, nothing to hydrate. Its whole job is reaching the client components
 * that cannot read the database themselves.
 */
export function BackgroundProvider({
  value,
  children,
}: {
  value: SiteBackground;
  children: React.ReactNode;
}) {
  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}
