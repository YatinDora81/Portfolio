import type { ContentStatus } from "db";
import { STATUS_LABEL, statusChip } from "@/lib/lifecycle";

export function StatusBadge({ status, dot = true }: { status: ContentStatus; dot?: boolean }) {
  return (
    <span className={statusChip(status)}>
      {dot ? <span className="dot" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}
