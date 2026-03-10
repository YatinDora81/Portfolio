import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, ...props }, ref) => (
    <div>
      {label && (
        <label className="block text-sm font-medium mb-1.5 text-foreground/80">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-all duration-150 resize-y min-h-[80px]",
          "placeholder:text-muted-foreground/50",
          "focus:border-primary focus:ring-2 focus:ring-primary/15 focus:shadow-sm",
          "hover:border-border/80",
          error && "border-destructive focus:border-destructive focus:ring-destructive/15",
          className
        )}
        {...props}
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
);
Textarea.displayName = "Textarea";
