import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, mono, ...props }, ref) => (
    <div className="f">
      {label && <label>{label}</label>}
      <input ref={ref} className={cn("in", mono && "mono", className)} {...props} />
      {hint && !error && <div className="f-hint">{hint}</div>}
      {error && <div className="f-hint" style={{ color: "var(--bad)" }}>{error}</div>}
    </div>
  )
);
Input.displayName = "Input";
