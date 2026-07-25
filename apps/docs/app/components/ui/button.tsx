import { cn } from "@/lib/utils";
import { forwardRef } from "react";

// Maps the app's existing variant names onto the control-room `.btn` modifiers,
// so every call site keeps working untouched.
const variants = {
  primary: "pri",
  destructive: "danger",
  outline: "",
  ghost: "ghost",
};

// `.btn` carries its own padding; sizes only nudge it.
const sizes = {
  sm: "text-[12px] px-[10px] py-[5px]",
  md: "",
  lg: "text-[13.5px] px-4 py-[9px]",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button ref={ref} className={cn("btn", variants[variant], sizes[size], className)} {...props} />
  )
);
Button.displayName = "Button";

/** Bare icon button — the `.ibtn` used in row action clusters. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "warn" | "amber" }
>(({ className, tone = "default", ...props }, ref) => (
  <button
    ref={ref}
    className={cn("ibtn", tone === "warn" && "warn", tone === "amber" && "amber", className)}
    {...props}
  />
));
IconButton.displayName = "IconButton";
