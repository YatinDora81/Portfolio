"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { IconX } from "@tabler/icons-react";

export function Dialog({ open, onClose, title, icon: Icon, children, footer, wide, className }: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // fixed positioning breaks inside a transformed ancestor, so portal out
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(document.querySelector(".cr") ?? document.body); }, []);

  if (!open || !host) return null;

  return createPortal(
    <div
      className="veil"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={cn("modal", className)} style={wide ? { maxWidth: 620 } : undefined}>
        <div className="modal-h">
          {Icon ? <Icon size={16} color="var(--amber)" /> : null}
          <div className="modal-t">{title}</div>
          <button className="ibtn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer ? <div className="modal-f">{footer}</div> : null}
      </div>
    </div>,
    host,
  );
}
