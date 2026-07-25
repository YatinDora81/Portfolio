import { cn } from "@/lib/utils";

/**
 * Control-room card. `flush` drops the inner padding for content that should
 * sit edge to edge — tables, `.rows` lists, `.qcard` stacks.
 */
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

/** Card header strip: title, optional `/ 04` count, and right-aligned actions. */
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
