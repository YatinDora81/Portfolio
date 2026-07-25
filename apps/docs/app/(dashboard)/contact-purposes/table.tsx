"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createContactPurpose, updateContactPurpose, deleteContactPurpose } from "@/lib/actions/contact-purposes";
import { IconPlus, IconPencil, IconGripVertical, IconInbox } from "@tabler/icons-react";

interface Purpose { id: string; label: string; emoji: string; sortOrder: number }

const FORM_ID = "contact-purpose-form";

export function ContactPurposesTable({ purposes }: { purposes: Purpose[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Purpose | null>(null);

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Purpose chips"
        count={purposes.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add purpose
          </Button>
        }
      />

      {purposes.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconInbox size={18} stroke={1.5} /></div>
          <b>No purposes yet</b>
          <span>Visitors pick one of these chips before writing you a message.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first purpose</Button>
        </div>
      ) : (
        <div className="rows">
          {purposes.map((p, i) => (
            <div key={p.id} className="row">
              <IconGripVertical size={14} className="row-grip" />
              <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
              <span style={{ fontSize: 16, lineHeight: 1, flex: "none" }} aria-hidden>{p.emoji}</span>
              <div className="row-main">
                <div className="row-t">{p.label}</div>
              </div>
              <div className="row-acts">
                <IconButton
                  aria-label={`Edit ${p.label}`}
                  onClick={() => { setEditing(p); setDialogOpen(true); }}
                >
                  <IconPencil size={13} stroke={1.5} />
                </IconButton>
                <DeleteButton label={`"${p.label}"`} onDelete={async () => { await deleteContactPurpose(p.id); }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit purpose" : "Add purpose"}
        icon={IconInbox}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Save changes" : "Create purpose"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={async (formData) => {
            if (editing) await updateContactPurpose(editing.id, formData);
            else await createContactPurpose(formData);
            setDialogOpen(false);
          }}
        >
          <div className="f-row" style={{ gridTemplateColumns: "88px 1fr" }}>
            <Input name="emoji" label="Emoji" defaultValue={editing?.emoji || ""} required />
            <Input name="label" label="Label" defaultValue={editing?.label || ""} required />
          </div>
          <div className="f-hint">Shown as a chip above the contact form — one emoji, a short label.</div>
        </form>
      </Dialog>
    </Card>
  );
}
