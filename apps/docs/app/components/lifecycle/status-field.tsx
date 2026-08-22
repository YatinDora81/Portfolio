"use client";

import { useEffect, useState } from "react";
import type { ContentStatus } from "db";
import { Select } from "@/components/ui/select";
import {
  CONTENT_STATUSES, STATUS_LABEL, STATUS_NOTE,
  isContentStatus, istInputToUtc,
} from "@/lib/lifecycle";
import { IconAlertTriangle, IconClock } from "@tabler/icons-react";

/**
 * The status selector, and the datetime picker that only Scheduled needs.
 *
 * The old control here was a hidden `<input name="show">` behind a switch, read
 * on the server as `formData.get("show") === "true"`. Both halves of that are
 * gone together and on purpose: strict equality against a field that might not
 * arrive turns every save into an un-publish, so the replacement is a real,
 * named `<select>` whose value the action refuses to guess at.
 *
 * The picker's field is called `publishAtIst`, not `publishAt`. The zone is not
 * in the value — `<input type="datetime-local">` hands back a bare wall clock —
 * so it is carried in the name instead, where the action reading it cannot miss
 * it.
 */
export function StatusField({ noun, status, onStatus, publishAtIst, onPublishAt, error }: {
  /** "post" or "project" — the copy names the thing being scheduled. */
  noun: string;
  status: ContentStatus;
  onStatus: (next: ContentStatus) => void;
  /** "YYYY-MM-DDTHH:mm" in IST, or "" when nothing is set. */
  publishAtIst: string;
  onPublishAt: (next: string) => void;
  /** The server's or the submit check's complaint about this field. */
  error?: string | null;
}) {
  /**
   * "Is that time in the past" needs `Date.now()`, and a clock is the one thing
   * the server and the browser will always disagree about. Rendering the answer
   * during SSR would tear the tree down on hydration, so the check is gated on
   * having mounted: the first paint says nothing, and the warning appears a
   * frame later on the client only.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const scheduled = status === "SCHEDULED";
  const parsed = scheduled ? istInputToUtc(publishAtIst) : null;
  const past = mounted && parsed !== null && parsed.getTime() <= Date.now();

  return (
    <div className="lc-field">
      <Select
        name="status"
        label="Status"
        value={status}
        onChange={(e) => {
          const next = e.target.value;
          // Narrowed, never defaulted. A value that is not one of the four is a
          // bug somewhere above, and quietly falling back to DRAFT would hide
          // it by taking the thing off the site.
          if (isContentStatus(next)) onStatus(next);
        }}
        options={CONTENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        hint={STATUS_NOTE[status]}
      />

      {scheduled ? (
        <div className="f">
          <label htmlFor="lc-publish-at">Publish at</label>
          <input
            id="lc-publish-at"
            name="publishAtIst"
            type="datetime-local"
            className="in mono"
            required
            value={publishAtIst}
            onChange={(e) => onPublishAt(e.target.value)}
            aria-describedby="lc-publish-at-hint"
          />

          <div className="f-hint" id="lc-publish-at-hint">
            <IconClock size={12} stroke={1.6} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Indian Standard Time, UTC+5:30. Typed in IST, stored in UTC —{" "}
            {parsed
              ? <>this {noun} would be written as <code>{parsed.toISOString().replace(".000Z", "Z")}</code>.</>
              : <>the exact instant appears here once the field is complete.</>}
          </div>

          {past ? (
            <div className="lc-warn">
              <b><IconAlertTriangle size={13} stroke={1.7} /> That time has already passed</b>
              Saving would leave the {noun} sitting as Scheduled with nothing left to wait for.
              Move the time forward, or set the status to Published.
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rv-err lc-field-err">{error}</div>
      ) : null}
    </div>
  );
}
