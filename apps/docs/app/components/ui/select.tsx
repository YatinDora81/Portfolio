import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { IconChevronDown } from "@tabler/icons-react";

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
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-10 py-2 text-sm outline-none transition-all duration-150",
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
        <IconChevronDown
          size={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
);
Select.displayName = "Select";
