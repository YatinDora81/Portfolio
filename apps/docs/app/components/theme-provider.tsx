"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark1" | "dark2";

/** html classes per theme — `dark` must stay for Tailwind's dark variant
    and every `.dark .x` rule; the theme-* class carries the token palette. */
const THEME_CLASS: Record<Theme, string> = {
  light: "",
  dark1: "dark theme-gh",
  dark2: "dark theme-zinc",
};

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyTheme(t: Theme) {
  document.documentElement.classList.remove("dark", "theme-gh", "theme-zinc");
  for (const c of THEME_CLASS[t].split(" ").filter(Boolean)) {
    document.documentElement.classList.add(c);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("admin-theme");
    // migrate the old two-way value: "dark" → Dark2 (zinc·teal default)
    const initial: Theme =
      stored === "dark" ? "dark2"
      : stored === "light" || stored === "dark1" || stored === "dark2" ? stored
      : "light";
    setThemeState(initial);
    applyTheme(initial);
    setMounted(true);
  }, []);

  function setTheme(next: Theme) {
    setThemeState(next);
    localStorage.setItem("admin-theme", next);
    applyTheme(next);
  }

  if (!mounted) return null;

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
