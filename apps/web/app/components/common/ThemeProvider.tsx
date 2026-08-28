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
  const [theme, setTheme] = useState<Theme>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
    // don't clobber the inline script's class before adopting it
    if (!ready) return;
    const root = document.documentElement;
    // re-adding the same class re-resolves every element's styles
    if (root.classList.contains(theme)) return;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  }, [theme, ready]);

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
