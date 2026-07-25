import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, mono, ...props }, ref) => (
    <div className="f">
      {label && <label>{label}</label>}
      <textarea ref={ref} className={cn("ta", mono && "mono", className)} {...props} />
      {hint && !error && <div className="f-hint">{hint}</div>}
      {error && <div className="f-hint" style={{ color: "var(--bad)" }}>{error}</div>}
    </div>
  )
);
Textarea.displayName = "Textarea";
