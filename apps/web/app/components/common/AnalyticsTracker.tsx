'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const ENDPOINT = '/api/collect';
const ATTR_KEY = 'attr';
const CAMPAIGN_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
];

type Attribution = {
  utm?: { source?: string; medium?: string; campaign?: string };
  linkSlug?: string;
  referrer: string | null;
  landingPath: string;
};

function optedOut(): boolean {
  const nav: Navigator & { globalPrivacyControl?: boolean } = navigator;
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function readStored(): Attribution | null {
  try {
    const raw = window.sessionStorage.getItem(ATTR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<Attribution>;
    // A truncated entry would fail the endpoint's schema and silently drop the
    // pageview; re-capturing from the current URL is the better failure.
    if (typeof candidate.landingPath !== 'string') return null;
    return candidate as Attribution;
  } catch {
    return null;
  }
}

// Strip the campaign tags whether or not this visit captured them, so a URL
// copied out of the address bar mid-session cannot carry someone else's source.
function cleanUrl(url: URL): void {
  let stripped = false;
  for (const key of CAMPAIGN_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      stripped = true;
    }
  }
  if (!stripped) return;
  // Deferred to a macrotask: UtmTrackerBeacon reads these same params from
  // window.location in its own mount effect, and sibling effects all flush
  // synchronously before the first timeout. Stripping inline raced it and left
  // the beacon reading a URL this component had already rewritten.
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.setTimeout(() => window.history.replaceState(null, '', next), 0);
}

/**
 * Captured once per tab and replayed from sessionStorage on every later send.
 * 🚨 Re-reading `document.referrer` after a client-side navigation returns this
 * site, which would rewrite every visitor's source as an internal referral.
 */
function loadAttribution(): Attribution {
  const url = new URL(window.location.href);
  const stored = readStored();
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

function send(path: string, attribution: Attribution): void {
  const body = JSON.stringify({
    events: [{ type: 'PAGEVIEW', path }],
    referrer: attribution.referrer,
    utm: attribution.utm,
    linkSlug: attribution.linkSlug,
    landingPath: attribution.landingPath,
  });

  // 🚨 sendBeacon survives the unload that cancels a plain fetch — without it the
  // bounced visits, the ones worth measuring most, are the ones that go missing.
  try {
    if (
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
    ) {
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (optedOut()) return;
    // Strict Mode runs this twice on mount, and dev points at the live database.
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;
    send(pathname, loadAttribution());
  }, [pathname]);

  return null;
}
