"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createHeroTitle, updateHeroTitle, deleteHeroTitle } from "@/lib/actions/hero";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Title { id: string; title: string; sortOrder: number }

export function HeroTitlesTable({ titles }: { titles: Title[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Title | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Title
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">#</th>
            <th className="pb-3 font-medium">Title</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {titles.map((t, i) => (
            <tr key={t.id} className="border-b border-border last:border-0">
              <td className="py-3 text-muted-foreground">{i + 1}</td>
              <td className="py-3">{t.title}</td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(t); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label={`"${t.title}"`} onDelete={async () => { await deleteHeroTitle(t.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {titles.length === 0 && (
            <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No titles yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Title" : "Add Title"}>
        <form action={async (formData) => {
          if (editing) await updateHeroTitle(editing.id, formData);
          else await createHeroTitle(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="title" label="Title" defaultValue={editing?.title || ""} required />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
