import { cn } from "@/lib/utils";

const variants = {
  default: "bg-primary/10 text-primary border border-primary/15",
  success: "bg-success/10 text-success border border-success/15",
  warning: "bg-warning/10 text-warning border border-warning/15",
  destructive: "bg-destructive/10 text-destructive border border-destructive/15",
  outline: "border border-border text-muted-foreground",
};

export function Badge({ children, variant = "default", className }: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}
