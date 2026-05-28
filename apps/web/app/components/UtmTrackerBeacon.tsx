"use client";

import { useEffect } from "react";

const STORAGE_KEY = "utm-tracker:last";

export default function UtmTrackerBeacon() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const source = url.searchParams.get("utm_source");
    const medium = url.searchParams.get("utm_medium");
    const campaign = url.searchParams.get("utm_campaign");
    const content = url.searchParams.get("utm_content");
    const term = url.searchParams.get("utm_term");
    const messageId = url.searchParams.get("mid");

    // Only track when all core outreach UTMs are present.
    if (!source || !medium || !campaign || !content) return;

    const fingerprint = JSON.stringify({
      source,
      medium,
      campaign,
      content,
      term,
      messageId,
      path: url.pathname,
    });

    // Prevent duplicate inserts for the same UTM payload during SPA hydration/reloads.
    if (sessionStorage.getItem(STORAGE_KEY) === fingerprint) return;
    sessionStorage.setItem(STORAGE_KEY, fingerprint);

    void fetch("/api/track/utm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        medium,
        campaign,
        content,
        term,
        messageId,
        path: url.pathname,
      }),
      keepalive: true,
    });
  }, []);

  return null;
}
