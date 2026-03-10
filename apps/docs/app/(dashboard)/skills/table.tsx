"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DeleteButton } from "@/components/shared/delete-button";
import { createSkill, updateSkill, toggleSkillVisibility, deleteSkill } from "@/lib/actions/skills";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Skill { id: string; name: string; iconKey: string; show: boolean; sortOrder: number }

export function SkillsTable({ skills }: { skills: Skill[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Skill
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">#</th>
            <th className="pb-3 font-medium">Name</th>
            <th className="pb-3 font-medium">Icon Key</th>
            <th className="pb-3 font-medium">Visible</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s, i) => (
            <tr key={s.id} className="border-b border-border last:border-0">
              <td className="py-3 text-muted-foreground">{i + 1}</td>
              <td className="py-3 font-medium">{s.name}</td>
              <td className="py-3 font-mono text-xs text-muted-foreground">{s.iconKey}</td>
              <td className="py-3">
                <Switch checked={s.show} onChange={async (val) => { await toggleSkillVisibility(s.id, val); }} />
              </td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(s); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label={`"${s.name}"`} onDelete={async () => { await deleteSkill(s.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {skills.length === 0 && (
            <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No skills yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Skill" : "Add Skill"}>
        <form action={async (formData) => {
          if (editing) await updateSkill(editing.id, formData);
          else await createSkill(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="iconKey" label="Icon Key" defaultValue={editing?.iconKey || ""} required />
          <div className="flex items-center gap-2">
            <input type="hidden" name="show" value={editing?.show !== false ? "true" : "false"} />
            <label className="text-sm">
              <input type="checkbox" name="show" value="true" defaultChecked={editing?.show !== false} className="mr-2" />
              Show in skills grid
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
