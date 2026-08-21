"use client";

import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, label, ariaLabel, disabled }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible caption beside the toggle, which also names it for assistive tech. */
  label?: string;
  /**
   * Names the switch where the design wants no visible caption. The row around
   * it says which switch this is on screen, but a screen reader reaches the
   * button alone — and a page full of unlabelled ones is a page of switches all
   * called "toggle". Wins over `label` when both are set.
   */
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel || label || "toggle"}
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
