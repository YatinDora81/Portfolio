import type { ContentStatus } from "db";
import { STATUS_LABEL, statusChip } from "@/lib/lifecycle";

/**
 * Not `<Badge>`. That component maps five names onto three `.chip` modifiers —
 * `warning` and `destructive` both resolve to `amb` — so two of the four states
 * would have come out the same amber, which is the one thing a status badge
 * cannot do. The four `.st-*` modifiers it uses instead are appended in
 * control-room.css.
 *
 * A server component on purpose: every list row renders one, and none of them
 * needs a byte of JavaScript.
 */
export function StatusBadge({ status, dot = true }: { status: ContentStatus; dot?: boolean }) {
  return (
    <span className={statusChip(status)}>
      {dot ? <span className="dot" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}
