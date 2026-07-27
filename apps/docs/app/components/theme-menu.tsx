"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme, type Theme } from "./theme-provider";

const OPTIONS: { value: Theme; label: string; swatch: string; swatchBorder?: string; dot: string }[] = [
  { value: "light", label: "Light",  swatch: "#FFFFFF", dot: "#6A5AE0" },
  { value: "dark1", label: "Dark1",  swatch: "#0D1117", swatchBorder: "#30363D", dot: "#58A6FF" },
  { value: "dark2", label: "Dark2",  swatch: "#18181B", swatchBorder: "#3F3F46", dot: "#2DD4BF" },
];

export default function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = OPTIONS.find(o => o.value === theme) ?? OPTIONS[0]!;

  return (
    <div className={`thm${open ? " open" : ""}`} ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="thm-btn"
        aria-label={`Theme: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span className="thm-lbl">{current.label}</span>
        <svg className="thm-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="thm-menu" role="listbox" aria-label="Theme">
          {OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={theme === o.value}
              className={`thm-it${theme === o.value ? " on" : ""}`}
              onClick={() => { setTheme(o.value); setOpen(false); btnRef.current?.focus(); }}
            >
              <span className="thm-sw" style={{ background: o.swatch, borderColor: o.swatchBorder }}>
                <i style={{ background: o.dot }} />
              </span>
              {o.label}
              <svg className="ck" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
