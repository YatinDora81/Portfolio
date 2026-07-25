"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createQuote, updateQuote, deleteQuote } from "@/lib/actions/quotes";
import { IconPlus, IconPencil, IconQuote } from "@tabler/icons-react";

interface Quote { id: string; quote: string; author: string }

export function QuotesTable({ quotes }: { quotes: Quote[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [saving, setSaving] = useState(false);

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Rotation"
        count={quotes.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} /> Add quote
          </Button>
        }
      />

      {quotes.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconQuote size={18} stroke={1.5} /></div>
          <b>No quotes yet</b>
          <span>Add one and it becomes the line the portfolio shows today.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} /> Add quote</Button>
        </div>
      ) : (
        <div>
          {quotes.map((q, i) => (
            <div key={q.id} className={i === 0 ? "qcard today" : "qcard"}>
              <span className="row-i" style={{ marginTop: 4 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="qtext">&ldquo;{q.quote}&rdquo;</div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 5, flexWrap: "wrap" }}>
                  <span className="qauth" style={{ marginTop: 0 }}>— {q.author}</span>
                  {i === 0 && (
                    <span className="chip amb"><span className="dot" /> showing today</span>
                  )}
                </div>
              </div>
              <div className="row-acts">
                <button
                  className="ibtn"
                  aria-label={`Edit quote by ${q.author}`}
                  onClick={() => { setEditing(q); setDialogOpen(true); }}
                >
                  <IconPencil size={13} stroke={1.5} />
                </button>
                <DeleteButton label="this quote" onDelete={async () => { await deleteQuote(q.id); }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit quote" : "Add quote"}
        icon={IconQuote}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="quote-form" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
          </>
        }
      >
        <form
          id="quote-form"
          action={async (formData) => {
            setSaving(true);
            try {
              if (editing) await updateQuote(editing.id, formData);
              else await createQuote(formData);
              setDialogOpen(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Textarea
            name="quote"
            label="Quote"
            defaultValue={editing?.quote || ""}
            required
            rows={4}
            hint="No quote marks needed — the site adds them."
          />
          <Input name="author" label="Author" defaultValue={editing?.author || ""} required />
        </form>
      </Dialog>
    </Card>
  );
}
