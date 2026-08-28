import Link from "next/link";
import type { ContentStatus } from "db";
import { CONTENT_STATUSES, STATUS_LABEL } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

export function StatusTabs({ base, active, counts, total }: {
  base: string;
  active: ContentStatus | null;
  counts: Record<ContentStatus, number>;
  total: number;
}) {
  return (
    <div className="filters lc-tabs">
      <Link
        href={base}
        className={cn("filt", active === null && "on")}
        aria-current={active === null ? "page" : undefined}
      >
        All <b>{total}</b>
      </Link>

      {CONTENT_STATUSES.map((status) => (
        <Link
          key={status}
          href={`${base}?status=${status}`}
          className={cn("filt", active === status && "on", counts[status] === 0 && "lc-tab-0")}
          aria-current={active === status ? "page" : undefined}
        >
          {STATUS_LABEL[status]} <b>{counts[status]}</b>
        </Link>
      ))}
    </div>
  );
}
