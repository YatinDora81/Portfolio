"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createAboutParagraph, updateAboutParagraph, deleteAboutParagraph } from "@/lib/actions/about";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Paragraph { id: string; content: string; sortOrder: number }

export function AboutParagraphsTable({ paragraphs }: { paragraphs: Paragraph[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Paragraph | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Paragraph
        </Button>
      </div>
      <div className="space-y-3">
        {paragraphs.map((p, i) => (
          <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-border">
            <span className="text-muted-foreground text-sm mt-0.5">{i + 1}.</span>
            <p className="flex-1 text-sm leading-relaxed">{p.content}</p>
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                <IconEdit size={16} />
              </Button>
              <DeleteButton label="this paragraph" onDelete={async () => { await deleteAboutParagraph(p.id); }} />
            </div>
          </div>
        ))}
        {paragraphs.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">No paragraphs yet</p>
        )}
      </div>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Paragraph" : "Add Paragraph"}>
        <form action={async (formData) => {
          if (editing) await updateAboutParagraph(editing.id, formData);
          else await createAboutParagraph(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Textarea name="content" label="Content" defaultValue={editing?.content || ""} required rows={5} />
          <p className="text-xs text-muted-foreground">Use **text** for bold formatting</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
