"use client";

import { useEffect, useState } from "react";
import { IconDeviceDesktop, IconDeviceMobile, IconEye, IconLock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

type PreviewWidth = "mobile" | "desktop";
const WIDTH_KEY = "admin-preview-width";
const MOBILE_WIDTH = 390;

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
  pendingCount?: number;
}) {
  const [width, setWidth] = useState<PreviewWidth>("desktop");

  useEffect(() => {
    try {
      if (localStorage.getItem(WIDTH_KEY) === "mobile") setWidth("mobile");
    } catch { /* ignore */ }
  }, []);

  function pick(next: PreviewWidth) {
    setWidth(next);
    try { localStorage.setItem(WIDTH_KEY, next); } catch { /* ignore */ }
  }

  const mobile = width === "mobile";

  return (
    <div className={cn("mt-6", className)}>
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

export const DIM = "#909092";

export const FAINT = "#737373";

export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function SectionLabel({ sub, main }: { sub: string; main: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px]" style={{ color: DIM }}>{sub}</p>
      <h3 className="text-base font-bold text-[#fafafa]">{main}</h3>
    </div>
  );
}

export function renderBold(text: string, logos?: Record<string, string>) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <span key={i}>{part}</span>;
    const key = part.trim().toLowerCase();
    const logo = logos && Object.hasOwn(logos, key) ? logos[key] : undefined;
    return (
      <b key={i} className="text-[#fafafa]">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="mr-1 inline-block size-3 rounded-[2px] object-contain align-[-0.15em]"
          />
        )}
        {part}
      </b>
    );
  });
}

// Same cadence as `RotatingRole` in apps/web: 2500ms hold, 400ms fade.
const ROTATE_MS = 2500;
export const FADE_MS = 400;

export function useRotatingTitle(count: number) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (count < 2) { setAnimate(false); return; }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAnimate(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [count]);

  useEffect(() => {
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

  return { index: count > 0 ? index % count : 0, visible };
}

export function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: "" };
}
