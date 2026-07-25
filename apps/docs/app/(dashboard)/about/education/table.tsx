"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createEducation, updateEducation, deleteEducation } from "@/lib/actions/about";
import { IconPlus, IconPencil, IconGripVertical, IconSchool } from "@tabler/icons-react";

interface Entry {
  id: string; institution: string; location: string; degree: string;
  scoreType: string | null; score: string | null; scoreTotal: string | null;
  startYear: string; endYear: string; sortOrder: number;
}

const FORM_ID = "education-form";

/** "9.1 / 10 CGPA" or "88 %" — null when the entry carries no score. */
function scoreLabel(e: Entry) {
  if (!e.score) return null;
  const total = e.scoreTotal ? ` / ${e.scoreTotal}` : "";
  const unit = e.scoreType === "PERCENTAGE" ? " %" : e.scoreType === "CGPA" ? " CGPA" : "";
  return `${e.score}${total}${unit}`;
}

export function EducationTable({ entries }: { entries: Entry[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Education entries"
        count={entries.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add education
          </Button>
        }
      />

      {entries.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconSchool size={18} stroke={1.5} /></div>
          <b>No education entries yet</b>
          <span>These appear as a timeline beside the about section&apos;s bio.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first entry</Button>
        </div>
      ) : (
        <div className="rows">
          {entries.map((e, i) => {
            const score = scoreLabel(e);
            return (
              <div key={e.id} className="row">
                <IconGripVertical size={14} className="row-grip" />
                <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
                <div className="row-main">
                  <div className="row-t">{e.institution}</div>
                  <div className="row-m">
                    {e.degree} · {e.location} · {e.startYear}–{e.endYear}
                  </div>
                </div>
                {score ? <span className="chip">{score}</span> : null}
                <div className="row-acts">
                  <IconButton
                    aria-label={`Edit ${e.institution}`}
                    onClick={() => { setEditing(e); setDialogOpen(true); }}
                  >
                    <IconPencil size={13} stroke={1.5} />
                  </IconButton>
                  <DeleteButton label={`"${e.institution}"`} onDelete={async () => { await deleteEducation(e.id); }} />
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
            <Button type="submit" form={FORM_ID}>{editing ? "Save changes" : "Create entry"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={async (formData) => {
            if (editing) await updateEducation(editing.id, formData);
            else await createEducation(formData);
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
          <div className="f-hint">Leave the score fields blank if you&apos;d rather not publish a grade.</div>
        </form>
      </Dialog>
    </Card>
  );
}
