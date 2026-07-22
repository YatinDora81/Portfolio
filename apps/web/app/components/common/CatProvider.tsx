'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const CatContext = createContext<{
  showCat: boolean;
  toggleCat: () => void;
}>({ showCat: true, toggleCat: () => {} });

export function useCat() {
  return useContext(CatContext);
}

export function CatProvider({ children }: { children: React.ReactNode }) {
  // Default ON for a new visitor. We only ever persist a preference once the
  // user explicitly toggles, so a fresh user (no stored value) always starts on.
  const [showCat, setShowCat] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('showCat');
      if (stored !== null) setShowCat(stored === 'true');
    } catch {
      // localStorage unavailable (private mode / disabled) — keep the default.
    }
  }, []);

  // The visible cat is the #oneko element injected by /oneko/oneko.js (loaded
  // from the root layout, outside this provider). Drive its visibility here so
  // the toggle works no matter when the script finishes creating it.
  useEffect(() => {
    const apply = (el: HTMLElement | null) => {
      if (el) el.style.display = showCat ? '' : 'none';
    };

    const existing = document.getElementById('oneko');
    if (existing) {
      apply(existing);
      return;
    }

    // Not created yet — watch for it, apply once, then stop watching.
    const observer = new MutationObserver(() => {
      const el = document.getElementById('oneko');
      if (el) {
        apply(el);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [showCat]);

  const toggleCat = () =>
    setShowCat((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('showCat', String(next));
      } catch {
        // Ignore storage failures — the toggle still works for this session.
      }
      return next;
    });

  return (
    <CatContext.Provider value={{ showCat, toggleCat }}>
      {children}
    </CatContext.Provider>
  );
}
