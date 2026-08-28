import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, options, ...props }, ref) => (
    <div className="f">
      {label && <label>{label}</label>}
      <select ref={ref} className={cn("sel", className)} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && !error && <div className="f-hint">{hint}</div>}
      {error && <div className="f-hint" style={{ color: "var(--bad)" }}>{error}</div>}
    </div>
  )
);
Select.displayName = "Select";
