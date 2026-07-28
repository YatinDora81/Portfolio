"use client";

import { useEffect, useState } from "react";
import { IconDeviceDesktop, IconDeviceMobile, IconEye, IconLock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// ─── Preview Frame ───────────────────────────────────────────────
// A browser window, drawn with admin tokens, wrapped around a pane that mimics
// the portfolio's dark mode.

/** Same fallback as the sidebar / top-bar; only the host goes in the URL strip. */
const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

type PreviewWidth = "mobile" | "desktop";
const WIDTH_KEY = "admin-preview-width";
const MOBILE_WIDTH = 390;

// `--dim`, not `--faint`: the resting segment sits on the `--bg2` track, where
// light mode's #8E8E9A measures 2.77:1 — under the 4.5:1 this 10px label needs,
// and under the 3:1 its icon needs. `--dim` is 6.18:1 there and stays the
// lighter of the two greys in both dark themes.
const SEG_BTN: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 7,
  fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, color: "var(--dim)", transition: ".15s",
};

function WidthButton({ on, onClick, title, children }: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      style={on
        ? { ...SEG_BTN, color: "var(--ink)", background: "var(--card)", boxShadow: "0 1px 2px rgba(23,30,48,.07)" }
        : SEG_BTN}
    >
      {children}
    </button>
  );
}

export function PreviewFrame({ children, label = "Portfolio Preview", className, pendingCount = 0 }: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  /** Staged ops already folded into `children` — shows a marker when > 0. */
  pendingCount?: number;
}) {
  const [width, setWidth] = useState<PreviewWidth>("desktop");

  // Read the stored choice after mount only — touching localStorage during
  // render would desync from the server HTML.
  useEffect(() => {
    try {
      if (localStorage.getItem(WIDTH_KEY) === "mobile") setWidth("mobile");
    } catch { /* private mode — the desktop default is fine */ }
  }, []);

  function pick(next: PreviewWidth) {
    setWidth(next);
    try { localStorage.setItem(WIDTH_KEY, next); } catch { /* ignore */ }
  }

  const mobile = width === "mobile";

  return (
    <div className={cn("mt-6", className)}>
      {/* Frame chrome follows the admin theme; the pane below stays pinned to the
          portfolio's own dark palette because that's what it's simulating. */}
      <div className="card-h" style={{ border: "none", padding: "0 2px 10px", flexWrap: "wrap" }}>
        <IconEye size={14} style={{ color: "var(--faint)" }} />
        <span className="card-t">{label}</span>
        {pendingCount > 0 && (
          <span className="chip amb" title="Staged edits — this preview is ahead of what's saved">
            <span className="dot" aria-hidden="true" />
            showing {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
          </span>
        )}
        <div className="sp" />
        <div
          role="group"
          aria-label="Preview width"
          style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 9, background: "var(--bg2)", border: "1px solid var(--line2)" }}
        >
          <WidthButton on={mobile} onClick={() => pick("mobile")} title={`Mobile — ${MOBILE_WIDTH}px`}>
            <IconDeviceMobile size={12} />Mobile
          </WidthButton>
          <WidthButton on={!mobile} onClick={() => pick("desktop")} title="Desktop — full width">
            <IconDeviceDesktop size={12} />Desktop
          </WidthButton>
        </div>
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r3)", overflow: "hidden", boxShadow: "var(--shadow)" }}>
        {/* Window chrome — admin tokens, so it reads as a frame in all three themes */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", background: "var(--bg1)", borderBottom: "1px solid var(--line2)" }}>
          <span style={{ display: "flex", gap: 5, flex: "none" }} aria-hidden="true">
            <span className="dot" style={{ background: "var(--bad)", opacity: .8 }} />
            <span className="dot" style={{ background: "var(--amber)", opacity: .8 }} />
            <span className="dot" style={{ background: "var(--good)", opacity: .8 }} />
          </span>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0, maxWidth: 340,
              padding: "3px 9px", borderRadius: 99, background: "var(--card)", border: "1px solid var(--line2)",
              fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            <IconLock size={9} style={{ flex: "none" }} />
            {SITE_HOST}
          </span>
        </div>

        {/* Viewport — on mobile the device is centred and the surround stays visible */}
        <div style={{ display: "flex", justifyContent: "center", background: "var(--bg2)", padding: mobile ? "16px 12px" : 0 }}>
          <div
            style={{
              width: mobile ? MOBILE_WIDTH : "100%", maxWidth: "100%", minWidth: 0,
              background: '#0a0a0a', color: '#fafafa',
              fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
              borderRadius: mobile ? 14 : 0,
              border: mobile ? '1px solid rgba(255,255,255,0.14)' : 'none',
              overflow: "hidden",
            }}
          >
            <div className="p-5 sm:p-6" style={{ color: '#fafafa' }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared ink and type ─────────────────────────────────────────
// One value each, imported by every section, so the pane can't drift into two
// greys or two monospaces for the same semantic role.

/** `.text-secondary` in apps/web/globals.css — the site's secondary ink for
 *  every string these previews mirror. NOT `--muted-foreground` (#a3a3a3):
 *  that token is only correct where the site itself reaches for it, e.g. the
 *  contact form's `placeholder:text-muted-foreground/50`. */
export const DIM = "#909092";

/** Preview-only meta text — the italic "not set" notes and the counted hints
 *  that have no counterpart on the site, held a step back from `DIM`. */
export const FAINT = "#737373";

/** The site's `--font-mono` is JetBrains Mono, so the pane asks for it first
 *  and degrades to the platform monospace. Deliberately not the admin's
 *  `var(--mono)`: that resolves to 'Geist Mono', a literal family name
 *  `next/font/local` never registers (it exposes a hashed one via
 *  `--font-geist-mono`), so the two stacks could land on different faces in
 *  the same pane. */
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ─── Shared helpers ──────────────────────────────────────────────

/** Mirrors apps/web/app/components/common/SectionHeading.tsx at preview scale:
 *  a sentence-case secondary sub-line over a bold heading. The site has no
 *  uppercase, letter-spaced eyebrow anywhere in a section head — only the size
 *  is reduced here. */
export function SectionLabel({ sub, main }: { sub: string; main: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px]" style={{ color: DIM }}>{sub}</p>
      <h3 className="text-base font-bold text-[#fafafa]">{main}</h3>
    </div>
  );
}

export function renderBold(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <b key={i} className="text-[#fafafa]">{part}</b> : <span key={i}>{part}</span>
  );
}

// Same cadence as `RotatingRole` in apps/web: 2500ms hold, 400ms fade.
const ROTATE_MS = 2500;
export const FADE_MS = 400;

/** Which title the live site would be showing right now, and whether it is
    mid-fade. Holds on the first title under reduced motion, or with < 2 titles. */
export function useRotatingTitle(count: number) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [animate, setAnimate] = useState(false);

  // Read the motion preference after mount only — reading it during render
  // would desync from the server HTML.
  useEffect(() => {
    if (count < 2) { setAnimate(false); return; }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAnimate(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [count]);

  useEffect(() => {
    // Un-fade FIRST, every time this effect runs. The pending `swap` below is
    // the only thing that ever restores `visible`, and the cleanup cancels it —
    // so a staged create/delete landing inside the 400ms fade would otherwise
    // strand the title at opacity 0. Permanently, once the list drops below two
    // titles: `animate` goes false and no interval is ever re-armed to fix it.
    setVisible(true);
    if (!animate) return;
    let swap: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setVisible(false);
      swap = setTimeout(() => {
        setIndex(prev => (prev + 1) % count);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(swap);
    };
  }, [animate, count]);

  // Wrapped here rather than in the setter so a staged delete that shortens the
  // list can never leave the index pointing past the end.
  return { index: count > 0 ? index % count : 0, visible };
}

// ─── Helper ──────────────────────────────────────────────────────

export function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: "" };
}
