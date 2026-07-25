"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createAboutParagraph, updateAboutParagraph, deleteAboutParagraph } from "@/lib/actions/about";
import { IconPlus, IconPencil, IconGripVertical, IconAlignLeft } from "@tabler/icons-react";

interface Paragraph { id: string; content: string; sortOrder: number }

const FORM_ID = "about-paragraph-form";

// Paragraphs run long, so the row title wraps to two lines instead of the
// single-line ellipsis `.row-t` gives short labels.
const clamp2: React.CSSProperties = {
  whiteSpace: "normal",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  fontWeight: 400,
  lineHeight: 1.55,
};

export function AboutParagraphsTable({ paragraphs }: { paragraphs: Paragraph[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Paragraph | null>(null);

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Bio paragraphs"
        count={paragraphs.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add paragraph
          </Button>
        }
      />

      {paragraphs.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconAlignLeft size={18} stroke={1.5} /></div>
          <b>No paragraphs yet</b>
          <span>These stack in order to form the about section&apos;s bio copy.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first paragraph</Button>
        </div>
      ) : (
        <div className="rows">
          {paragraphs.map((p, i) => (
            <div key={p.id} className="row" style={{ alignItems: "flex-start" }}>
              <IconGripVertical size={14} className="row-grip" style={{ marginTop: 3 }} />
              <div className="row-i" style={{ marginTop: 4 }}>{String(i + 1).padStart(2, "0")}</div>
              <div className="row-main">
                <div className="row-t" style={clamp2}>{p.content}</div>
                <div className="row-m">{p.content.length} characters</div>
              </div>
              <div className="row-acts">
                <IconButton
                  aria-label={`Edit paragraph ${i + 1}`}
                  onClick={() => { setEditing(p); setDialogOpen(true); }}
                >
                  <IconPencil size={13} stroke={1.5} />
                </IconButton>
                <DeleteButton label="this paragraph" onDelete={async () => { await deleteAboutParagraph(p.id); }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit paragraph" : "Add paragraph"}
        icon={IconAlignLeft}
        wide
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Save changes" : "Create paragraph"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={async (formData) => {
            if (editing) await updateAboutParagraph(editing.id, formData);
            else await createAboutParagraph(formData);
            setDialogOpen(false);
          }}
        >
          <Textarea
            name="content"
            label="Content"
            defaultValue={editing?.content || ""}
            required
            rows={7}
            hint="Wrap text in **double asterisks** to bold it on the live site."
          />
        </form>
      </Dialog>
    </Card>
  );
}
