import Link from "next/link";
import type { ContentStatus } from "db";
import { CONTENT_STATUSES, STATUS_LABEL } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

/**
 * All / Draft / Scheduled / Published / Archived, with counts.
 *
 * Links against `?status=`, not client state, and so no `"use client"`: the
 * rows behind the tabs are server-rendered and carry inline server closures for
 * delete, and the filter has to be readable by the page that queries them. It
 * also means a filtered view is a URL — the drafts list is something you can
 * bookmark or paste to yourself, which client state would not have given.
 *
 * Every tab is rendered even at zero. A tab that disappears when its count hits
 * zero takes the answer with it: "no posts are scheduled" is a fact worth
 * showing, and an absent tab reads as a missing feature instead.
 */
export function StatusTabs({ base, active, counts, total }: {
  /** The list route the tabs link back to, e.g. "/blogs". */
  base: string;
  /** The status currently filtered on, or null for All. */
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
