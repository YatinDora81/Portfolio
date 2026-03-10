import { cn } from "@/lib/utils";
import { forwardRef } from "react";

const variants = {
  primary:
    "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 active:brightness-95",
  destructive:
    "bg-destructive text-destructive-foreground shadow-sm shadow-destructive/20 hover:shadow-md hover:shadow-destructive/25 hover:brightness-110 active:brightness-95",
  outline:
    "border border-border bg-card hover:bg-muted text-foreground shadow-sm hover:shadow",
  ghost: "hover:bg-muted text-foreground",
};

const sizes = {
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-9 px-4 text-sm rounded-lg",
  lg: "h-10 px-6 text-sm rounded-lg",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
