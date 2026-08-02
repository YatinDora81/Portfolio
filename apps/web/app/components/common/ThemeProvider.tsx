'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({ theme: 'dark', toggleTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // NOTE: we intentionally always render `children`. The inline script in the
  // root layout already sets the correct `light`/`dark` class on <html> before
  // first paint, so the actual colors never flash. This provider only exposes
  // the current theme to the toggle button. Gating children behind a client-only
  // "mounted" flag (the old behaviour) blanked the entire server-rendered tree
  // and forced full client-side rendering — the cause of the empty prerendered
  // HTML shell. See ThemeProvider history.
  const [theme, setTheme] = useState<Theme>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Adopt whatever the inline script already resolved (class on <html>),
    // falling back to the stored preference / system setting.
    const root = document.documentElement;
    const stored = localStorage.getItem('theme') as Theme | null;
    const resolved: Theme =
      stored ??
      (root.classList.contains('dark')
        ? 'dark'
        : root.classList.contains('light')
          ? 'light'
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light');
    setTheme(resolved);
    setReady(true);
  }, []);

  useEffect(() => {
    // Don't touch the DOM until we've adopted the inline-script value, otherwise
    // we'd briefly clobber the correct class with our 'dark' default.
    //
    // This effect syncs the CLASS and nothing else. It used to write
    // localStorage too, which meant the first page view persisted the theme the
    // visitor had merely been *detected* as — after that the inline script's
    // `if (!theme)` branch was dead and the site never followed their OS again.
    if (!ready) return;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme, ready]);

  // Until the toggle is used there is no stored preference, so keep tracking the
  // OS the way a visitor who has never expressed a choice expects.
  //
  // The store is re-read INSIDE the handler, not once at subscribe time: toggling
  // does not change `ready`, so this effect never re-runs and the listener
  // outlives the choice. Read once, a visitor who toggled would have their
  // explicit pick silently overridden the next time their OS flipped.
  useEffect(() => {
    if (!ready) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (e: MediaQueryListEvent) => {
      if (localStorage.getItem('theme')) return;
      setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, [ready]);

  // The only place the choice is written down — an explicit act, not a detection.
  const toggleTheme = () =>
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      return next;
    });

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
