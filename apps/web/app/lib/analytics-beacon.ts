const ENDPOINT = '/api/collect';

export const ATTR_KEY = 'attr';

export type Attribution = {
  utm?: { source?: string; medium?: string; campaign?: string };
  linkSlug?: string;
  referrer: string | null;
  landingPath: string;
};

export type CollectEvent = {
  type: 'PAGEVIEW' | 'SECTION_DWELL';
  path: string;
  section?: string;
  label?: string;
  durationMs?: number;
};

export function optedOut(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav: Navigator & { globalPrivacyControl?: boolean } = navigator;
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

export function readAttribution(): Attribution | null {
  try {
    const raw = window.sessionStorage.getItem(ATTR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<Attribution>;
    if (typeof candidate.landingPath !== 'string') return null;
    return candidate as Attribution;
  } catch {
    return null;
  }
}

export function sendEvents(events: CollectEvent[], attribution: Attribution): void {
  const body = JSON.stringify({
    events,
    referrer: attribution.referrer,
    utm: attribution.utm,
    linkSlug: attribution.linkSlug,
    landingPath: attribution.landingPath,
  });

  // sendBeacon survives the unload that cancels a fetch
  try {
    if (
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
    ) {
      return;
    }
  } catch {
    // falls through to fetch
  }

  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
