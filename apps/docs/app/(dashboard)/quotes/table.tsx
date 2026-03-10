"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createQuote, updateQuote, deleteQuote } from "@/lib/actions/quotes";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Quote { id: string; quote: string; author: string }

export function QuotesTable({ quotes }: { quotes: Quote[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Quote
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">#</th>
            <th className="pb-3 font-medium">Quote</th>
            <th className="pb-3 font-medium">Author</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q, i) => (
            <tr key={q.id} className="border-b border-border last:border-0">
              <td className="py-3 text-muted-foreground">{i + 1}</td>
              <td className="py-3 max-w-[400px] truncate">{q.quote}</td>
              <td className="py-3 text-muted-foreground">{q.author}</td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(q); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label="this quote" onDelete={async () => { await deleteQuote(q.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {quotes.length === 0 && (
            <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No quotes yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Quote" : "Add Quote"}>
        <form action={async (formData) => {
          if (editing) await updateQuote(editing.id, formData);
          else await createQuote(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Textarea name="quote" label="Quote" defaultValue={editing?.quote || ""} required />
          <Input name="author" label="Author" defaultValue={editing?.author || ""} required />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
