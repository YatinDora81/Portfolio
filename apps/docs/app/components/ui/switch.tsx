"use client";

import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-[22px] w-10 shrink-0 rounded-full transition-all duration-200 cursor-pointer shadow-inner",
          checked ? "bg-primary shadow-primary/20" : "bg-muted-foreground/25"
        )}
      >
        <span
          className={cn(
            "pointer-events-none size-[18px] rounded-full bg-white shadow-sm transition-all duration-200 mt-[2px]",
            checked ? "translate-x-[20px]" : "translate-x-[2px]"
          )}
        />
      </button>
      {label && <span className="text-sm text-foreground/80">{label}</span>}
    </label>
  );
}
