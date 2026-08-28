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
  onDelete: () => void | Promise<void>;
  label?: string;
  sub?: string;
  staged?: boolean;
  newRow?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
