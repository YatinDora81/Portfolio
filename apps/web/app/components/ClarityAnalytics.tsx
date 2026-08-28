'use client';

import { useEffect } from 'react';
import Clarity from '@microsoft/clarity';

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
      // cookieless mode, no third-party cookies
      Clarity.consent(false);
    };

    events.forEach((e) =>
      window.addEventListener(e, start, { once: true, passive: true }),
    );
    // fallback for sessions with no interaction
    idleTimer = setTimeout(start, 6000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, start));
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  return null;
}
