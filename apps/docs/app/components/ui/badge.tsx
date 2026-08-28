import { cn } from "@/lib/utils";

const variants = {
  default: "",
  success: "on",
  warning: "amb",
  destructive: "amb",
  outline: "off",
};

export function Badge({ children, variant = "default", dot, className }: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("chip", variants[variant], className)}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}
