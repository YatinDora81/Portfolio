"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { IconX } from "@tabler/icons-react";

export function Dialog({ open, onClose, title, icon: Icon, children, footer, wide, className }: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  children: React.ReactNode;
  /** Optional sticky action row. Callers that render their own buttons inline still work. */
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

  if (!open) return null;

  return (
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
    </div>
  );
}
