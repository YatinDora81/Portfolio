"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { useStaging } from "@/components/staging/staging-provider";
import { useSortable } from "@/lib/use-sortable";
import {
  IconPlus, IconPencil, IconGripVertical, IconSchool, IconArrowBackUp,
  IconChevronUp, IconChevronDown,
} from "@tabler/icons-react";

interface Entry {
  id: string; institution: string; location: string; degree: string;
  scoreType: string | null; score: string | null; scoreTotal: string | null;
  startYear: string; endYear: string; sortOrder: number;
}

const FORM_ID = "education-form";

function scoreLabel(e: Entry) {
  if (!e.score) return null;
  const total = e.scoreTotal ? ` / ${e.scoreTotal}` : "";
  const unit = e.scoreType === "PERCENTAGE" ? " %" : e.scoreType === "CGPA" ? " CGPA" : "";
  return `${e.score}${total}${unit}`;
}

function fieldsFrom(formData: FormData) {
  const s = (k: string) => String(formData.get(k) ?? "");
  return {
    institution: s("institution"),
    location: s("location"),
    degree: s("degree"),
    scoreType: s("scoreType"),
    score: s("score"),
    scoreTotal: s("scoreTotal"),
    startYear: s("startYear"),
    endYear: s("endYear"),
  };
}

export function EducationTable({ entries }: { entries: Entry[] }) {
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited,
  } = useStaging();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);

  const staged = overlay("education", entries, (e) => e.id);

  const { order, handleProps, itemProps } = useSortable(
    staged.map((e) => e.id),
    (ids) => stageReorder("education", ids)
  );

  const rank = new Map(order.map((id, i) => [id, i] as const));
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rows = [...staged].sort((a, b) => at(a.id) - at(b.id));

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  const move = (from: number, to: number) => {
    const ids = rows.map((e) => e.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder("education", ids);
  };

  const mark = (id: string) =>
    isDeleted("education", id) ? "staged-del"
      : isNew("education", id) ? "staged-new"
        : isEdited("education", id) ? "staged-edit"
          : null;

  return (
    <Card flush>
      <CardHead
        title="Education entries"
        count={rows.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add education
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconSchool size={18} stroke={1.5} /></div>
          <b>No education entries yet</b>
          <span>These appear as a timeline beside the about section&apos;s bio.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first entry</Button>
        </div>
      ) : (
        <div className="rows">
          {rows.map((e, i) => {
            const score = scoreLabel(e);
            const gone = isDeleted("education", e.id);
            return (
              <div key={e.id} className={cn("row sortable", mark(e.id))} {...itemProps(e.id)}>
                <span className="row-grip" title="Drag to reorder" {...handleProps(e.id)}>
                  <IconGripVertical size={14} />
                </span>
                <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
                <div className="row-main">
                  <div className="row-t">{e.institution}</div>
                  <div className="row-m">
                    {e.degree} · {e.location} · {e.startYear}–{e.endYear}
                  </div>
                </div>
                {score ? <span className="chip">{score}</span> : null}
                <div className="row-acts">
                  {gone ? (
                    <IconButton
                      aria-label={`Keep ${e.institution}`}
                      title="Undo delete"
                      onClick={() => unstageDelete("education", e.id)}
                    >
                      <IconArrowBackUp size={13} stroke={1.5} />
                    </IconButton>
                  ) : (
                    <>
                      <IconButton
                        className="move"
                        aria-label={`Move ${e.institution} earlier`}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        <IconChevronUp size={13} stroke={1.6} />
                      </IconButton>
                      <IconButton
                        className="move"
                        aria-label={`Move ${e.institution} later`}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <IconChevronDown size={13} stroke={1.6} />
                      </IconButton>
                      <IconButton
                        aria-label={`Edit ${e.institution}`}
                        onClick={() => { setEditing(e); setDialogOpen(true); }}
                      >
                        <IconPencil size={13} stroke={1.5} />
                      </IconButton>
                      <DeleteButton
                        staged
                        newRow={isNew("education", e.id)}
                        label={`"${e.institution}"`}
                        onDelete={() => stageDelete("education", e.id)}
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
        title={editing ? "Edit education" : "Add education"}
        icon={IconSchool}
        wide
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Update entry" : "Add entry"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={(formData) => {
            const fields = fieldsFrom(formData);
            if (editing) stageUpdate("education", editing.id, fields);
            else stageCreate("education", fields);
            setDialogOpen(false);
          }}
        >
          <Input name="institution" label="Institution" defaultValue={editing?.institution || ""} required />
          <div className="f-row">
            <Input name="location" label="Location" defaultValue={editing?.location || ""} required />
            <Input name="degree" label="Degree" defaultValue={editing?.degree || ""} required />
          </div>
          <div className="f-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <Select
              name="scoreType"
              label="Score type"
              defaultValue={editing?.scoreType || ""}
              options={[
                { value: "", label: "None" },
                { value: "CGPA", label: "CGPA" },
                { value: "PERCENTAGE", label: "Percentage" },
              ]}
            />
            <Input name="score" label="Score" defaultValue={editing?.score || ""} />
            <Input name="scoreTotal" label="Total" defaultValue={editing?.scoreTotal || ""} />
          </div>
          <div className="f-row">
            <Input name="startYear" label="Start year" defaultValue={editing?.startYear || ""} required />
            <Input name="endYear" label="End year" defaultValue={editing?.endYear || ""} required />
          </div>
          <div className="f-hint">
            Leave the score fields blank if you&apos;d rather not publish a grade. Nothing here is written
            until you save.
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
