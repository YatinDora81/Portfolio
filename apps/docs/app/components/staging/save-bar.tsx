"use client";

import { useMemo, useState } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Entity } from "@/lib/actions/staging";
import { useStaging } from "./staging-provider";

/**
 * The page-level Cancel / Save / Save & Publish bar.
 *
 * It mounts as the last child of `.content`, i.e. inside the scroller, so it is
 * sticky *in flow*: the last row of a list can always be scrolled clear of it
 * (`.content.with-savebar` widens the trailing band while it is up), and it
 * never needs to win a fight on the z-index ladder. Styling is `.savebar` in
 * `control-room.css`.
 */

/**
 * Where each entity is edited. The store deliberately outlives a route change —
 * the leave dialog promises as much — so the batch can name rows that are not on
 * screen, and Cancel has to be able to say where they live.
 */
const WHERE: Record<Entity, string> = {
  heroTitle: "Hero · titles",
  heroSkillBadge: "Hero · skill badges",
  aboutParagraph: "About · paragraphs",
  education: "About · education",
  skill: "Skills",
  quote: "Quotes",
  contactPurpose: "Contact purposes",
  socialLink: "Social links",
  adminUser: "Admin users",
};

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

      {/* Deliberately a SIBLING of `.savebar`, not a child: the bar carries a
          `backdrop-filter`, which makes it the containing block for any fixed
          descendant — the dialog's full-viewport veil would collapse into the
          bar's own 40px-tall box. Out here it behaves like every other dialog
          in `.content`.

          Cancel throws away the whole batch, and the batch spans pages — on
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
