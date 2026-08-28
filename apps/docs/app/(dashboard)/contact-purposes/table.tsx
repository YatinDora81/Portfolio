"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import type { Entity } from "@/lib/actions/staging";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";
import {
  IconPlus, IconPencil, IconGripVertical, IconInbox, IconArrowBackUp,
  IconChevronUp, IconChevronDown,
} from "@tabler/icons-react";

interface Purpose { id: string; label: string; emoji: string; sortOrder: number }

const FORM_ID = "contact-purpose-form";
const ENTITY: Entity = "contactPurpose";

export function ContactPurposesTable({ purposes }: { purposes: Purpose[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Purpose | null>(null);
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited,
  } = useStaging();

  const staged = overlay(ENTITY, purposes, (p) => p.id);
  const { order, handleProps, itemProps } = useSortable(
    staged.map((p) => p.id),
    (ids) => stageReorder(ENTITY, ids)
  );
  // a new row has no drag slot yet
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rows = [...staged].sort((a, b) => at(a.id) - at(b.id));

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  const move = (from: number, to: number) => {
    const ids = rows.map((p) => p.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder(ENTITY, ids);
  };

  return (
    <Card flush>
      <CardHead
        title="Purpose chips"
        count={rows.filter((p) => !isDeleted(ENTITY, p.id)).length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add purpose
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconInbox size={18} stroke={1.5} /></div>
          <b>No purposes yet</b>
          <span>Visitors pick one of these chips before writing you a message.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first purpose</Button>
        </div>
      ) : (
        <div className="rows">
          {rows.map((p, i) => {
            const del = isDeleted(ENTITY, p.id);
            const mark = del
              ? "staged-del"
              : isNew(ENTITY, p.id) ? "staged-new" : isEdited(ENTITY, p.id) ? "staged-edit" : null;
            return (
              <div key={p.id} className={cn("row sortable", mark)} {...itemProps(p.id)}>
                <span className="row-grip" title="Drag to reorder" {...handleProps(p.id)}>
                  <IconGripVertical size={14} />
                </span>
                <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
                <span style={{ fontSize: 16, lineHeight: 1, flex: "none" }} aria-hidden>{p.emoji}</span>
                <div className="row-main">
                  <div className="row-t">{p.label}</div>
                </div>
                <div className="row-acts">
                  {del ? (
                    <IconButton
                      aria-label={`Keep ${p.label}`}
                      title="Undo delete"
                      onClick={() => unstageDelete(ENTITY, p.id)}
                    >
                      <IconArrowBackUp size={13} stroke={1.5} />
                    </IconButton>
                  ) : (
                    <>
                      <IconButton
                        className="move"
                        aria-label={`Move ${p.label} earlier`}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        <IconChevronUp size={13} stroke={1.6} />
                      </IconButton>
                      <IconButton
                        className="move"
                        aria-label={`Move ${p.label} later`}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <IconChevronDown size={13} stroke={1.6} />
                      </IconButton>
                      <IconButton
                        aria-label={`Edit ${p.label}`}
                        onClick={() => { setEditing(p); setDialogOpen(true); }}
                      >
                        <IconPencil size={13} stroke={1.5} />
                      </IconButton>
                      <DeleteButton
                        staged
                        newRow={isNew(ENTITY, p.id)}
                        label={`"${p.label}"`}
                        onDelete={() => stageDelete(ENTITY, p.id)}
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
        title={editing ? "Edit purpose" : "Add purpose"}
        icon={IconInbox}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Update purpose" : "Add purpose"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const fields = {
              emoji: String(data.get("emoji") ?? ""),
              label: String(data.get("label") ?? ""),
            };
            if (editing) stageUpdate(ENTITY, editing.id, fields);
            else stageCreate(ENTITY, fields);
            setDialogOpen(false);
          }}
        >
          <div className="f-row" style={{ gridTemplateColumns: "88px 1fr" }}>
            <Input name="emoji" label="Emoji" defaultValue={editing?.emoji || ""} required />
            <Input name="label" label="Label" defaultValue={editing?.label || ""} required />
          </div>
          <div className="f-hint">Shown as a chip above the contact form — one emoji, a short label.</div>
        </form>
      </Dialog>
    </Card>
  );
}
