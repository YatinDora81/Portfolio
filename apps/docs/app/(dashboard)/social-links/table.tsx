"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createSocialLink, updateSocialLink, deleteSocialLink } from "@/lib/actions/social-links";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Link { id: string; name: string; href: string; iconKey: string; detail: string | null; sortOrder: number }

export function SocialLinksTable({ links }: { links: Link[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Link
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">#</th>
            <th className="pb-3 font-medium">Name</th>
            <th className="pb-3 font-medium">URL</th>
            <th className="pb-3 font-medium">Icon Key</th>
            <th className="pb-3 font-medium">Detail</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {links.map((l, i) => (
            <tr key={l.id} className="border-b border-border last:border-0">
              <td className="py-3 text-muted-foreground">{i + 1}</td>
              <td className="py-3 font-medium">{l.name}</td>
              <td className="py-3 text-muted-foreground text-xs max-w-[200px] truncate">{l.href}</td>
              <td className="py-3 font-mono text-xs text-muted-foreground">{l.iconKey}</td>
              <td className="py-3 text-muted-foreground text-xs">{l.detail || "—"}</td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(l); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label={`"${l.name}"`} onDelete={async () => { await deleteSocialLink(l.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {links.length === 0 && (
            <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No links yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Link" : "Add Link"}>
        <form action={async (formData) => {
          if (editing) await updateSocialLink(editing.id, formData);
          else await createSocialLink(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="href" label="URL" defaultValue={editing?.href || ""} required />
          <Input name="iconKey" label="Icon Key" defaultValue={editing?.iconKey || ""} required />
          <Input name="detail" label="Detail (optional)" defaultValue={editing?.detail || ""} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
