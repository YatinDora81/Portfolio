"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";
import {
  IconPlus, IconPencil, IconGripVertical, IconSparkles, IconArrowBackUp,
  IconChevronUp, IconChevronDown,
} from "@tabler/icons-react";

type Version = "v1" | "v2";

interface Title { id: string; title: string; sortOrder: number; version: string }

const FORM_ID = "hero-title-form";

export function HeroTitlesTable({ titles, version }: {
  titles: Title[];
  version: Version;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Title | null>(null);
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited, saving,
  } = useStaging();

  const staged = overlay("heroTitle", titles, (t) => t.id, version);

  // filter after the overlay, or staged creates get stranded
  const mine = staged.filter((t) => t.version === version);

  const { order, handleProps, itemProps } = useSortable(
    mine.map((t) => t.id),
    (ids) => stageReorder("heroTitle", ids, version),
    { disabled: saving }
  );

  const byId = new Map(mine.map((t) => [t.id, t] as const));
  const seen = new Set(order);
  const rows = [...order.flatMap((id) => byId.get(id) ?? []), ...mine.filter((t) => !seen.has(t.id))];

  const mark = (id: string) =>
    isDeleted("heroTitle", id) ? "staged-del"
      : isNew("heroTitle", id) ? "staged-new"
        : isEdited("heroTitle", id) ? "staged-edit"
          : null;

  // indices are into `rows`, which is not aligned with `order`
  const move = (from: number, to: number) => {
    const ids = rows.map((t) => t.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder("heroTitle", ids, version);
  };

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Role titles"
        count={rows.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add title
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconSparkles size={18} stroke={1.5} /></div>
          <b>No {version} titles yet</b>
          <span>The role line right under your name reads from here. Add two or more and it cycles through them.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first title</Button>
        </div>
      ) : (
        <div className="rows">
          {rows.map((t, i) => {
            const del = isDeleted("heroTitle", t.id);
            return (
            <div key={t.id} className={cn("row sortable", mark(t.id))} {...itemProps(t.id)}>
              <span className="row-grip" title="Drag to reorder" {...handleProps(t.id)}>
                <IconGripVertical size={14} />
              </span>
              <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
              <div className="row-main">
                <div className="row-t">{t.title}</div>
              </div>
              <div className="row-acts">
                <IconButton
                  className="move"
                  aria-label={`Move ${t.title} earlier`}
                  disabled={i === 0 || del || saving}
                  onClick={() => move(i, i - 1)}
                >
                  <IconChevronUp size={13} stroke={1.6} />
                </IconButton>
                <IconButton
                  className="move"
                  aria-label={`Move ${t.title} later`}
                  disabled={i === rows.length - 1 || del || saving}
                  onClick={() => move(i, i + 1)}
                >
                  <IconChevronDown size={13} stroke={1.6} />
                </IconButton>
                {del ? (
                  <IconButton
                    aria-label={`Keep ${t.title}`}
                    title="Undo delete"
                    onClick={() => unstageDelete("heroTitle", t.id)}
                  >
                    <IconArrowBackUp size={13} stroke={1.6} />
                  </IconButton>
                ) : (
                  <>
                    <IconButton
                      aria-label={`Edit ${t.title}`}
                      onClick={() => { setEditing(t); setDialogOpen(true); }}
                    >
                      <IconPencil size={13} stroke={1.5} />
                    </IconButton>
                    <DeleteButton
                      staged
                      newRow={isNew("heroTitle", t.id)}
                      label={`"${t.title}"`}
                      onDelete={() => stageDelete("heroTitle", t.id)}
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
        title={editing ? "Edit title" : "Add title"}
        icon={IconSparkles}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Save changes" : "Create title"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={(formData) => {
            const title = String(formData.get("title") ?? "").trim();
            if (!title) return;
            if (editing) stageUpdate("heroTitle", editing.id, { title });
            else stageCreate("heroTitle", { title, version });
            setDialogOpen(false);
          }}
        >
          <Input
            name="title"
            label="Title"
            defaultValue={editing?.title || ""}
            required
            hint="Shown one at a time under your name — a few words reads best."
          />
        </form>
      </Dialog>
    </Card>
  );
}
