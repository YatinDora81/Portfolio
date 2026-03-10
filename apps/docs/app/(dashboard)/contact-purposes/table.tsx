"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createContactPurpose, updateContactPurpose, deleteContactPurpose } from "@/lib/actions/contact-purposes";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Purpose { id: string; label: string; emoji: string; sortOrder: number }

export function ContactPurposesTable({ purposes }: { purposes: Purpose[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Purpose | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Purpose
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">#</th>
            <th className="pb-3 font-medium">Emoji</th>
            <th className="pb-3 font-medium">Label</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {purposes.map((p, i) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="py-3 text-muted-foreground">{i + 1}</td>
              <td className="py-3 text-xl">{p.emoji}</td>
              <td className="py-3">{p.label}</td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label={`"${p.label}"`} onDelete={async () => { await deleteContactPurpose(p.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {purposes.length === 0 && (
            <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No purposes yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Purpose" : "Add Purpose"}>
        <form action={async (formData) => {
          if (editing) await updateContactPurpose(editing.id, formData);
          else await createContactPurpose(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="emoji" label="Emoji" defaultValue={editing?.emoji || ""} required />
          <Input name="label" label="Label" defaultValue={editing?.label || ""} required />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
