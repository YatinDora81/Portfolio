"use client";

import { useMemo, useState } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Entity } from "@/lib/actions/staging";
import { WHERE } from "@/lib/audit";
import { useStaging } from "./staging-provider";

export function SaveBar() {
  const { ops, count, saving, discardAll, commit } = useStaging();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [asking, setAsking] = useState(false);

  const breakdown = useMemo(() => {
    const tally = new Map<Entity, number>();
    for (const op of ops) tally.set(op.entity, (tally.get(op.entity) ?? 0) + 1);
    return [...tally].map(([entity, n]) => ({ entity, n }));
  }, [ops]);

  async function run(publish: boolean) {
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
