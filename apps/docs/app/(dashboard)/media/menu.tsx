"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  kb?: string;
  danger?: boolean;
  disabled?: boolean;
  reason?: string;
  href?: string;
  newTab?: boolean;
  run?: () => void;
}

export type MenuEntry = MenuItem | "sep";

export interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}

const EDGE = 8;

function place(at: number, size: number, edge: number): number {
  return Math.max(EDGE, at + size + EDGE <= edge ? at : Math.min(at - size, edge - size - EDGE));
}

export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => { setHost(document.querySelector(".cr") ?? document.body); }, []);

  const rovers = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-mi]") ?? [])];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({
      left: place(x, el.offsetWidth, window.innerWidth),
      top: place(y, el.offsetHeight, window.innerHeight),
    });
  }, [x, y, host, items.length]);

  useEffect(() => {
    const list = rovers();
    (list.find((el) => !el.dataset.off) ?? list[0])?.focus();
  }, [host]);

  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) closeRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeRef.current(); } };
    const gone = () => closeRef.current();
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", gone);
    window.addEventListener("blur", gone);
    window.addEventListener("scroll", gone, true);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("blur", gone);
      window.removeEventListener("scroll", gone, true);
    };
  }, []);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const list = rovers();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); onClose(); }
    else if (e.key === " " && document.activeElement instanceof HTMLAnchorElement) {
      e.preventDefault();
      document.activeElement.click();
    }
  };

  if (!host) return null;

  return createPortal(
    <div
      ref={ref}
      className="nt-menu"
      role="menu"
      aria-label={label}
      style={pos ?? { left: 0, top: 0 }}
      onKeyDown={onKeyDown}
      onMouseDown={stop}
      onClick={stop}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.map((row, i) => {
        if (row === "sep") return <div key={`sep${i}`} className="nt-msep" role="separator" />;
        const Icon = row.icon;
        const body = (
          <>
            {Icon ? <Icon size={15} /> : null}
            {row.label}
            {row.kb ? <span className="nt-mk">{row.kb}</span> : null}
          </>
        );
        return row.href && !row.disabled ? (
          <a
            key={row.key}
            data-mi
            role="menuitem"
            tabIndex={-1}
            className={cn("nt-mi", row.danger && "danger")}
            href={row.href}
            title={row.reason}
            target={row.newTab ? "_blank" : undefined}
            rel={row.newTab ? "noreferrer" : undefined}
            onClick={onClose}
          >
            {body}
          </a>
        ) : (
          <button
            key={row.key}
            data-mi
            data-off={row.disabled ? "1" : undefined}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cn("nt-mi", row.danger && "danger", row.disabled && "dimmed")}
            aria-disabled={row.disabled || undefined}
            title={row.reason}
            onClick={() => { if (row.disabled) return; onClose(); row.run?.(); }}
          >
            {body}
          </button>
        );
      })}
    </div>,
    host,
  );
}
