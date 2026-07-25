"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconTrash } from "@tabler/icons-react";

export function DeleteButton({ onDelete, label = "this item", sub }: {
  onDelete: () => Promise<void>;
  label?: string;
  /** Override the consequence line when deletion cascades. */
  sub?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button className="ibtn warn" onClick={() => setOpen(true)} aria-label={`Delete ${label}`}>
        <IconTrash size={13} stroke={1.5} />
      </button>
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
              <IconTrash size={13} /> {pending ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p style={{ color: "var(--dim)", fontSize: 13.5 }}>
          {sub || "This removes it from the live site the next time you publish. There's no undo here."}
        </p>
      </Dialog>
    </>
  );
}
