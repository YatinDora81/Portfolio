"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";
import {
  IconPlus, IconPencil, IconGripVertical, IconAlignLeft, IconArrowBackUp,
  IconChevronUp, IconChevronDown,
} from "@tabler/icons-react";

interface Paragraph { id: string; content: string; sortOrder: number }

const FORM_ID = "about-paragraph-form";

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
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited, saving,
  } = useStaging();

  const staged = overlay("aboutParagraph", paragraphs, (p) => p.id);

  const { order, handleProps, itemProps } = useSortable(
    staged.map((p) => p.id),
    (ids) => stageReorder("aboutParagraph", ids),
    { disabled: saving }
  );

  const byId = new Map(staged.map((p) => [p.id, p] as const));
  const seen = new Set(order);
  // order re-seeds after a render, so append anything staged this tick
  const rows = [...order.flatMap((id) => byId.get(id) ?? []), ...staged.filter((p) => !seen.has(p.id))];

  const mark = (id: string) =>
    isDeleted("aboutParagraph", id) ? "staged-del"
      : isNew("aboutParagraph", id) ? "staged-new"
        : isEdited("aboutParagraph", id) ? "staged-edit"
          : null;

  // indices are rows indices; rows is not positionally aligned with order
  const move = (from: number, to: number) => {
    const ids = rows.map((p) => p.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder("aboutParagraph", ids);
  };

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Bio paragraphs"
        count={rows.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add paragraph
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconAlignLeft size={18} stroke={1.5} /></div>
          <b>No paragraphs yet</b>
          <span>These stack in order to form the about section&apos;s bio copy.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first paragraph</Button>
        </div>
      ) : (
        <div className="rows">
          {rows.map((p, i) => {
            const del = isDeleted("aboutParagraph", p.id);
            const grip = handleProps(p.id);
            return (
            <div
              key={p.id}
              className={cn("row sortable", mark(p.id))}
              style={{ alignItems: "flex-start" }}
              {...itemProps(p.id)}
            >
              <span className="row-grip" title="Drag to reorder" {...grip} style={{ ...grip.style, marginTop: 3 }}>
                <IconGripVertical size={14} />
              </span>
              <div className="row-i" style={{ marginTop: 4 }}>{String(i + 1).padStart(2, "0")}</div>
              <div className="row-main">
                <div className="row-t" style={clamp2}>{p.content}</div>
                <div className="row-m">{p.content.length} characters</div>
              </div>
              <div className="row-acts">
                <IconButton
                  className="move"
                  aria-label={`Move paragraph ${i + 1} earlier`}
                  disabled={i === 0 || del || saving}
                  onClick={() => move(i, i - 1)}
                >
                  <IconChevronUp size={13} stroke={1.6} />
                </IconButton>
                <IconButton
                  className="move"
                  aria-label={`Move paragraph ${i + 1} later`}
                  disabled={i === rows.length - 1 || del || saving}
                  onClick={() => move(i, i + 1)}
                >
                  <IconChevronDown size={13} stroke={1.6} />
                </IconButton>
                {del ? (
                  <IconButton
                    aria-label={`Keep paragraph ${i + 1}`}
                    title="Undo delete"
                    onClick={() => unstageDelete("aboutParagraph", p.id)}
                  >
                    <IconArrowBackUp size={13} stroke={1.6} />
                  </IconButton>
                ) : (
                  <>
                    <IconButton
                      aria-label={`Edit paragraph ${i + 1}`}
                      onClick={() => { setEditing(p); setDialogOpen(true); }}
                    >
                      <IconPencil size={13} stroke={1.5} />
                    </IconButton>
                    <DeleteButton
                      staged
                      newRow={isNew("aboutParagraph", p.id)}
                      label="this paragraph"
                      onDelete={() => stageDelete("aboutParagraph", p.id)}
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
          action={(formData) => {
            const content = String(formData.get("content") ?? "").trim();
            if (!content) return;
            if (editing) stageUpdate("aboutParagraph", editing.id, { content });
            else stageCreate("aboutParagraph", { content });
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
