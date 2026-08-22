'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  ATTR_KEY,
  optedOut,
  readAttribution,
  sendEvents,
  type Attribution,
} from '@/lib/analytics-beacon';
import { useSectionDwell } from '@/hooks/use-section-dwell';

const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
];

function cleanUrl(url: URL): void {
  let stripped = false;
  for (const key of CAMPAIGN_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      stripped = true;
    }
  }
  if (!stripped) return;
  // Deferred to a macrotask so sibling mount effects still read the untouched URL.
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.setTimeout(() => window.history.replaceState(null, '', next), 0);
}

// Captured once per tab: after a client-side navigation `document.referrer` is this site.
function loadAttribution(): Attribution {
  const url = new URL(window.location.href);
  const stored = readAttribution();
  if (stored) {
    cleanUrl(url);
    return stored;
  }

  const params = url.searchParams;
  const source = params.get('utm_source');
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');
  const linkSlug = params.get('ref');

  const utm = {
    ...(source ? { source } : {}),
    ...(medium ? { medium } : {}),
    ...(campaign ? { campaign } : {}),
  };

  const attribution: Attribution = {
    ...(Object.keys(utm).length > 0 ? { utm } : {}),
    ...(linkSlug ? { linkSlug } : {}),
    referrer: document.referrer || null,
    landingPath: url.pathname,
  };

  try {
    window.sessionStorage.setItem(ATTR_KEY, JSON.stringify(attribution));
  } catch {
    // A blocked sessionStorage costs attribution on later pageviews, nothing more.
  }

  cleanUrl(url);
  return attribution;
}

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useSectionDwell(!optedOut());

  useEffect(() => {
    if (optedOut()) return;
    // Strict Mode runs this twice on mount, and dev points at the live database.
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;
    sendEvents([{ type: 'PAGEVIEW', path: pathname }], loadAttribution());
  }, [pathname]);

  return null;
}
