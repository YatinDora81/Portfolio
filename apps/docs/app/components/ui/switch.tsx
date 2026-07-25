"use client";

import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label || "toggle"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("tog", "amb", checked && "on")}
    />
  );

  if (!label) return toggle;

  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer">
      {toggle}
      <span style={{ fontSize: 13, color: "var(--dim)" }}>{label}</span>
    </label>
  );
}
