import { cn } from "@/lib/utils";

/**
 * The `.vh` view head — mono eyebrow, display title, one-line rationale.
 * `eyebrow` is optional so existing callers keep rendering unchanged.
 */
export function PageHeader({ title, description, eyebrow, children, className }: {
  title: string;
  description?: string;
  eyebrow?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("vh", className)}>
      <div className="vh-row">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {children && <div className="row-acts" style={{ gap: 8 }}>{children}</div>}
      </div>
    </div>
  );
}
