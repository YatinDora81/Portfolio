"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createEducation, updateEducation, deleteEducation } from "@/lib/actions/about";
import { IconPlus, IconEdit } from "@tabler/icons-react";

interface Entry {
  id: string; institution: string; location: string; degree: string;
  scoreType: string | null; score: string | null; scoreTotal: string | null;
  startYear: string; endYear: string; sortOrder: number;
}

export function EducationTable({ entries }: { entries: Entry[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);

  return (
    <Card>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <IconPlus size={16} /> Add Education
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-3 font-medium">Institution</th>
            <th className="pb-3 font-medium">Degree</th>
            <th className="pb-3 font-medium">Score</th>
            <th className="pb-3 font-medium">Years</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="py-3">
                <div className="font-medium">{e.institution}</div>
                <div className="text-xs text-muted-foreground">{e.location}</div>
              </td>
              <td className="py-3 text-muted-foreground">{e.degree}</td>
              <td className="py-3 text-muted-foreground">
                {e.score ? `${e.score}${e.scoreTotal ? `/${e.scoreTotal}` : ""}` : "—"}
              </td>
              <td className="py-3 text-muted-foreground">{e.startYear} - {e.endYear}</td>
              <td className="py-3 text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(e); setDialogOpen(true); }}>
                    <IconEdit size={16} />
                  </Button>
                  <DeleteButton label={`"${e.institution}"`} onDelete={async () => { await deleteEducation(e.id); }} />
                </div>
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No education entries yet</td></tr>
          )}
        </tbody>
      </table>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Edit Education" : "Add Education"} className="max-w-xl">
        <form action={async (formData) => {
          if (editing) await updateEducation(editing.id, formData);
          else await createEducation(formData);
          setDialogOpen(false);
        }} className="space-y-4">
          <Input name="institution" label="Institution" defaultValue={editing?.institution || ""} required />
          <Input name="location" label="Location" defaultValue={editing?.location || ""} required />
          <Input name="degree" label="Degree" defaultValue={editing?.degree || ""} required />
          <div className="grid grid-cols-3 gap-3">
            <Select name="scoreType" label="Score Type" defaultValue={editing?.scoreType || ""}
              options={[{ value: "", label: "None" }, { value: "CGPA", label: "CGPA" }, { value: "PERCENTAGE", label: "Percentage" }]} />
            <Input name="score" label="Score" defaultValue={editing?.score || ""} />
            <Input name="scoreTotal" label="Total" defaultValue={editing?.scoreTotal || ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input name="startYear" label="Start Year" defaultValue={editing?.startYear || ""} required />
            <Input name="endYear" label="End Year" defaultValue={editing?.endYear || ""} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
