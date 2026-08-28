import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  flush,
}: {
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <div className={cn("card", className)}>
      {flush ? children : <div className="card-b">{children}</div>}
    </div>
  );
}

export function CardHead({
  title,
  count,
  right,
}: {
  title: string;
  count?: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="card-h">
      <div className="card-t">{title}</div>
      {count != null ? <div className="card-n">/ {String(count).padStart(2, "0")}</div> : null}
      <div className="sp" />
      {right}
    </div>
  );
}
