"use client";

import { useMemo, useState } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Entity } from "@/lib/actions/staging";
import { WHERE } from "@/lib/audit";
import { useStaging } from "./staging-provider";

/**
 * The page-level Cancel / Save / Save & Publish bar.
 *
 * A band under the scroller — the last child of `.main`'s column — rather than
 * a sticky child of `.content`. Sticky only travels inside the content box, so
 * on a page shorter than the viewport it ran out of range and came to rest a
 * content-length-dependent distance above the bottom edge. As a sibling the
 * scroller ends where the bar begins, so the last row clears it for free.
 *
 * Styling is `.savebar` in `control-room.css`; `.savebar-inner` holds its
 * contents on the `.view` reading column.
 */

export function SaveBar() {
  const { ops, count, saving, discardAll, commit } = useStaging();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [asking, setAsking] = useState(false);

  // One line per surface, in the order the changes were staged.
  const breakdown = useMemo(() => {
    const tally = new Map<Entity, number>();
    for (const op of ops) tally.set(op.entity, (tally.get(op.entity) ?? 0) + 1);
    return [...tally].map(([entity, n]) => ({ entity, n }));
  }, [ops]);

  async function run(publish: boolean) {
    // Belt and braces with the store's own in-flight ref: neither button may put
    // a second batch in the air while the first is still out there.
    if (busy || saving) return;
    setBusy(publish ? "publish" : "save");
    try {
      await commit({ publish });
    } finally {
      setBusy(null);
    }
  }

  if (count === 0) return null;

  const disabled = saving || busy !== null;

  return (
    <>
      <div className="savebar" role="region" aria-label="Unsaved changes">
        <div className="savebar-inner">
          <span className="savebar-chip">
            <span className="dot" aria-hidden="true" />
            {count}
          </span>
          <span className="savebar-txt" aria-live="polite">
            <b>unsaved change{count === 1 ? "" : "s"}</b> — nothing is written until you save
          </span>

          <div className="savebar-acts">
            <Button variant="ghost" onClick={() => setAsking(true)} disabled={disabled}>Cancel</Button>
            <Button variant="outline" onClick={() => void run(false)} disabled={disabled}>
              {busy === "save" ? <IconRefresh size={13} className="spin" /> : null}
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
            <Button variant="primary" onClick={() => void run(true)} disabled={disabled}>
              {busy === "publish" ? <IconRefresh size={13} className="spin" /> : null}
              {busy === "publish" ? "Saving…" : "Save & Publish"}
            </Button>
          </div>
        </div>
      </div>

      {/* Cancel throws away the whole batch, and the batch spans pages — on
          /quotes it can be holding three hero titles no card here is marked
          with. Discarding that on one click, with nothing on screen to explain
          the number, is the one destructive button in the bar. */}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={`Discard ${count} unsaved change${count === 1 ? "" : "s"}?`}
        icon={IconAlertTriangle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>Keep editing</Button>
            <Button
              variant="destructive"
              onClick={() => { discardAll(); setAsking(false); }}
            >
              Discard {count === 1 ? "it" : "them all"}
            </Button>
          </>
        }
      >
        <p style={{ color: "var(--dim)", fontSize: 13.5, marginBottom: 12 }}>
          Nothing has been written yet, so this changes nothing on the live site — but the rows below
          go back to what the database says, and there is no undo for that.
        </p>
        {/* Always listed, even for a single surface: the whole point is that the
            batch can be holding rows the page you are looking at never shows. */}
        <div style={{ display: "grid", gap: 6 }}>
          {breakdown.map((g) => (
            <div key={g.entity} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
              <span className="chip amb">{g.n}</span>
              <span>{WHERE[g.entity]}</span>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}
