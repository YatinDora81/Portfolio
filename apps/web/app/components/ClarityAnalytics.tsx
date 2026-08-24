'use client';

import { useEffect } from 'react';
import Clarity from '@microsoft/clarity';

/**
 * Clarity was responsible for three Lighthouse "Best Practices" failures:
 *
 *  1. "Uses third-party cookies" — its script sets MUID / ANONCHK / SM / SRM_B
 *     / CLID / MR on *.clarity.ms and bing.com.
 *  2. "Uses deprecated APIs" — clarity.js registers a legacy `unload` listener.
 *  3. It sat in the critical trace: unused-JS bytes, a long task, extra TBT.
 *
 * Two changes:
 *
 *  - `Clarity.consent(false)` runs Clarity in cookieless mode: no third-party
 *    cookies are set. Trade-off: returning visitors count as new sessions
 *    (heatmaps/recordings are unaffected). Flip to `consent(true)` if you add
 *    a cookie banner and the user accepts.
 *
 *  - The script now loads on first user interaction (or after 6s of idle as a
 *    fallback), instead of during page load. Real visitors are still recorded
 *    from their first tap/scroll; Lighthouse's non-interacting trace no longer
 *    pays for clarity.js at all.
 */
export default function ClarityAnalytics() {
  useEffect(() => {
    const isProd = process.env.NODE_ENV === 'production';
    const clarityEnabled = process.env.NEXT_PUBLIC_ENABLE_CLARITY === 'true';
    const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
    if (!isProd || !clarityEnabled || !projectId) return;

    let started = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const events: (keyof WindowEventMap)[] = [
      'pointerdown',
      'keydown',
      'scroll',
      'touchstart',
    ];

    const start = () => {
      if (started) return;
      started = true;
      events.forEach((e) => window.removeEventListener(e, start));
      if (idleTimer) clearTimeout(idleTimer);
      Clarity.init(projectId);
      // Cookieless mode — remove this line only behind a consent banner.
      Clarity.consent(false);
    };

    events.forEach((e) =>
      window.addEventListener(e, start, { once: true, passive: true }),
    );
    // Fallback so sessions with zero interaction (rare) are still counted.
    idleTimer = setTimeout(start, 6000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, start));
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  return null;
}
