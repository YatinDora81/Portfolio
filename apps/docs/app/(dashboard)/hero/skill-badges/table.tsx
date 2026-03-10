"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createHeroSkillBadge, updateHeroSkillBadge, deleteHeroSkillBadge } from "@/lib/actions/hero";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Badge { id: string; name: string; iconKey: string; sortOrder: number }

export function HeroSkillBadgesTable({ badges }: { badges: Badge[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Badge | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Badge
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">#</th>
            <th className="pb-3 font-medium">Name</th>
            <th className="pb-3 font-medium">Icon Key</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {badges.map((b, i) => (
            <tr key={b.id} className="border-b border-border last:border-0">
              <td className="py-3 text-muted-foreground">{i + 1}</td>
              <td className="py-3">{b.name}</td>
              <td className="py-3 text-muted-foreground font-mono text-xs">{b.iconKey}</td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(b); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label={`"${b.name}"`} onDelete={async () => { await deleteHeroSkillBadge(b.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {badges.length === 0 && (
            <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No badges yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Badge" : "Add Badge"}>
        <form action={async (formData) => {
          if (editing) await updateHeroSkillBadge(editing.id, formData);
          else await createHeroSkillBadge(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="iconKey" label="Icon Key" defaultValue={editing?.iconKey || ""} required />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
