import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-card border border-border/60 rounded-xl p-6 shadow-sm transition-shadow duration-200 hover:shadow-md",
        className
      )}
    >
      {children}
    </div>
  );
}
