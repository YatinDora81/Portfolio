'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
export interface SweepOrigin { x: number; y: number }

type StartViewTransition = (update: () => void) => { ready: Promise<unknown> };

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: (origin?: SweepOrigin) => void;
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
    if (!ready) return;
    const root = document.documentElement;
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

  const toggleTheme = (origin?: SweepOrigin) => {
    const next: Theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';

    const commit = () => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(next);
      localStorage.setItem('theme', next);
      setTheme(next);
    };

    const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!origin || reduce || typeof start !== 'function') {
      commit();
      return;
    }

    const { x, y } = origin;
    const transition = start.call(document, commit);
    transition.ready
      .then(() => {
        const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 450, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => undefined);
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
