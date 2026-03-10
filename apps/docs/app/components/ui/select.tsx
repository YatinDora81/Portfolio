import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, ...props }, ref) => (
    <div>
      {label && (
        <label className="block text-sm font-medium mb-1.5 text-foreground/80">
          {label}
        </label>
      )}
      <select
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-all duration-150",
          "focus:border-primary focus:ring-2 focus:ring-primary/15 focus:shadow-sm",
          "hover:border-border/80",
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
);
Select.displayName = "Select";
