"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import { IconPlus, IconPencil, IconQuote, IconArrowBackUp } from "@tabler/icons-react";

interface Quote { id: string; quote: string; author: string }

export function QuotesTable({ quotes, dayOfYear }: { quotes: Quote[]; dayOfYear: number }) {
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete,
    isDeleted, isNew, isEdited,
  } = useStaging();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);

  // Quotes are the one staged entity with no sortOrder, so there is no reorder
  // op to fold in: the overlay only patches edits and appends pending creates.
  const rows = overlay("quote", quotes, (q) => q.id);

  // Which quote visitors get once this batch lands — `dayOfYear % count`, the
  // same pick apps/web makes, run over the list the site will actually have.
  // A staged delete shortens that list and moves the pick, so a server-computed
  // index would badge a row here while the preview below named another one and
  // the published site a third. Deleted rows stay visible for their undo but
  // are out of the rotation, so they can never carry the badge.
  const live = rows.filter((q) => !isDeleted("quote", q.id));
  const todayId = live.length > 0 ? live[dayOfYear % live.length]?.id ?? null : null;

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  /** Exactly one diff mark per card: gone beats new beats edited. */
  const mark = (id: string) =>
    isDeleted("quote", id) ? "staged-del"
      : isNew("quote", id) ? "staged-new"
        : isEdited("quote", id) ? "staged-edit"
          : null;

  return (
    <Card flush>
      <CardHead
        title="Rotation"
        count={rows.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} /> Add quote
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconQuote size={18} stroke={1.5} /></div>
          <b>No quotes yet</b>
          <span>Add one and it becomes the line the portfolio shows today.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} /> Add quote</Button>
        </div>
      ) : (
        <div>
          {rows.map((q, i) => {
            const gone = isDeleted("quote", q.id);
            return (
              <div key={q.id} className={cn("qcard", q.id === todayId && "today", mark(q.id))}>
                <span className="row-i" style={{ marginTop: 4 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="qtext">&ldquo;{q.quote}&rdquo;</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 5, flexWrap: "wrap" }}>
                    <span className="qauth" style={{ marginTop: 0 }}>— {q.author}</span>
                    {q.id === todayId && (
                      <span className="chip amb"><span className="dot" /> showing today</span>
                    )}
                  </div>
                </div>
                <div className="row-acts">
                  {gone ? (
                    // The card stays put, struck through, until the bar commits —
                    // so the undo lives where the delete was.
                    <button
                      className="ibtn"
                      aria-label="Keep this quote"
                      title="Undo delete"
                      onClick={() => unstageDelete("quote", q.id)}
                    >
                      <IconArrowBackUp size={13} stroke={1.5} />
                    </button>
                  ) : (
                    <>
                      <button
                        className="ibtn"
                        aria-label={`Edit quote by ${q.author}`}
                        onClick={() => { setEditing(q); setDialogOpen(true); }}
                      >
                        <IconPencil size={13} stroke={1.5} />
                      </button>
                      <DeleteButton
                        staged
                        newRow={isNew("quote", q.id)}
                        label="this quote"
                        onDelete={() => stageDelete("quote", q.id)}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
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
            {/* Not "Save": this only puts the card in the list. The save bar writes. */}
            <Button type="submit" form="quote-form">{editing ? "Update quote" : "Add quote"}</Button>
          </>
        }
      >
        <form
          id="quote-form"
          action={(formData) => {
            // A staged create has to carry every field the card renders, since
            // the overlay materialises the pending row out of exactly this bag.
            const fields = {
              quote: String(formData.get("quote") ?? ""),
              author: String(formData.get("author") ?? ""),
            };
            // Editing a row that is itself a pending create folds into that
            // create — the store keys on the id either way, tempId included.
            if (editing) stageUpdate("quote", editing.id, fields);
            else stageCreate("quote", fields);
            setDialogOpen(false);
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
