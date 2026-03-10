"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconTrash } from "@tabler/icons-react";

export function DeleteButton({ onDelete, label = "this item" }: { onDelete: () => Promise<void>; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
        <IconTrash size={15} stroke={1.5} />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Confirm Delete">
        <p className="text-sm text-muted-foreground mb-6">
          Are you sure you want to delete <span className="font-medium text-foreground">{label}</span>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => startTransition(async () => { await onDelete(); setOpen(false); })}
          >
            {pending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
