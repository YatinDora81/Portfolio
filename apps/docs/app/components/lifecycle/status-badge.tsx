import type { ContentStatus } from "db";
import { STATUS_LABEL, statusChip } from "@/lib/lifecycle";

// Not <Badge>: it collapses warning and destructive onto the same amber. The .st-* modifiers live in control-room.css.
export function StatusBadge({ status, dot = true }: { status: ContentStatus; dot?: boolean }) {
  return (
    <span className={statusChip(status)}>
      {dot ? <span className="dot" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}
