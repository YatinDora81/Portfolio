"use client";

import { cn } from "@/lib/utils";
import { IconX } from "@tabler/icons-react";

export function Dialog({ open, onClose, title, children, className }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative bg-card border border-border/60 rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl animate-dialog-in",
          className
        )}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <IconX size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
