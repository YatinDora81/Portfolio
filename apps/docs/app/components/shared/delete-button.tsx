"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconTrash } from "@tabler/icons-react";

export function DeleteButton({
  onDelete,
  label = "this item",
  sub,
  staged = false,
  newRow = false,
  disabled = false,
}: {
  /** Stages the delete when `staged`, writes it immediately otherwise. */
  onDelete: () => void | Promise<void>;
  label?: string;
  /** The consequence line, for a delete that reaches past the row itself. */
  sub?: string;
  /**
   * The delete goes to the staging store instead of the database, so the row
   * stays on screen with an undo until the save bar commits.
   */
  staged?: boolean;
  /**
   * This row exists only in the browser — it is itself a staged create. Deleting
   * it drops the create, which means there is no struck-through row and no undo.
   */
  newRow?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // A confirm's job is to stand in front of something the undo can't reach.
  //
  // The ordinary staged delete isn't that: the row stays visible, struck
  // through, with its own undo, and nothing reaches the database until Save. It
  // skips the dialog rather than teaching people to dismiss one.
  //
  // Two staged deletes still get it, because for them the undo is a lie:
  //  - `newRow` — the row has no server identity, so staging its delete removes
  //    the create outright. It vanishes, and everything typed into it goes too.
  //  - `sub` — the delete cascades past the row (a skill's tags, an account's
  //    access), and the row-level undo only covers the row.
  const confirms = !staged || newRow || !!sub;

  const trigger = (
    <button
      className="ibtn warn"
      onClick={() => { if (confirms) setOpen(true); else void onDelete(); }}
      disabled={disabled}
      title={confirms ? undefined : `Delete ${label} — undo until you save`}
      aria-label={`Delete ${label}`}
    >
      <IconTrash size={13} stroke={1.5} />
    </button>
  );

  if (!confirms) return trigger;

  const body = !staged
    ? sub || "This removes it from the live site the next time you publish. There's no undo here."
    : newRow
      ? "This one was never saved, so there's nothing to undo — deleting it discards what you typed."
      : `${sub ? `${sub} ` : ""}Nothing is written until you save, and the row keeps an undo until then.`;

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${label}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => startTransition(async () => { await onDelete(); setOpen(false); })}
            >
              <IconTrash size={13} /> {pending && !staged ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p style={{ color: "var(--dim)", fontSize: 13.5 }}>{body}</p>
      </Dialog>
    </>
  );
}
