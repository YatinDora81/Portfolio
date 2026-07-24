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
    if (!ready) return;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme, ready]);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
