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
  const [showCat, setShowCat] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('showCat');
      if (stored !== null) setShowCat(stored === 'true');
    } catch {
      // storage unavailable, keep the default
    }
  }, []);

  useEffect(() => {
    if (document.body.classList.contains('cat-on') !== showCat) {
      document.body.classList.toggle('cat-on', showCat);
    }

    const apply = (el: HTMLElement | null) => {
      if (el) el.style.display = showCat ? '' : 'none';
    };

    const existing = document.getElementById('oneko');
    if (existing) {
      apply(existing);
      return;
    }

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
        // ignore storage failures
      }
      return next;
    });

  return (
    <CatContext.Provider value={{ showCat, toggleCat }}>
      {children}
    </CatContext.Provider>
  );
}
