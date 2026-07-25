"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DeleteButton } from "@/components/shared/delete-button";
import { createSkill, updateSkill, toggleSkillVisibility, deleteSkill } from "@/lib/actions/skills";
import { IconPlus, IconPencil, IconEye, IconEyeOff, IconCpu } from "@tabler/icons-react";

interface Skill { id: string; name: string; iconKey: string; show: boolean; sortOrder: number }

/**
 * Skills have no `category` column, so the grouping key is the one real axis the
 * data gives us: whether a skill is published to the grid or kept around purely
 * as a relation tag. Sort order inside each group is the query's sortOrder.
 */
function groupSkills(skills: Skill[]) {
  return [
    { key: "grid", title: "in the skills grid", rows: skills.filter(s => s.show) },
    { key: "hidden", title: "hidden · tags only", rows: skills.filter(s => !s.show) },
  ].filter(g => g.rows.length > 0);
}

function SkillChip({ skill }: { skill: Skill }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className={cn("skill", !skill.show && "hid")}>
      <div>
        <div className="skill-n">{skill.name}</div>
        {/* Only worth surfacing when it diverges from the name — that mismatch is
            what decides which icon the site renders. */}
        {skill.iconKey !== skill.name && <div className="skill-u">{skill.iconKey}</div>}
      </div>
      <button
        className="ibtn"
        disabled={pending}
        aria-label={skill.show ? `Hide ${skill.name}` : `Show ${skill.name}`}
        title={skill.show ? "Hide from the grid" : "Show in the grid"}
        onClick={() => startTransition(async () => { await toggleSkillVisibility(skill.id, !skill.show); })}
      >
        {skill.show ? <IconEye size={13} stroke={1.5} /> : <IconEyeOff size={13} stroke={1.5} />}
      </button>
      <SkillEditButton skill={skill} />
      <DeleteButton
        label={`"${skill.name}"`}
        sub="This also drops it from every project and experience it's tagged on. There's no undo here."
        onDelete={async () => { await deleteSkill(skill.id); }}
      />
    </div>
  );
}

/** Edit opens the same dialog as Add, seeded with this skill. */
function SkillEditButton({ skill }: { skill: Skill }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ibtn" onClick={() => setOpen(true)} aria-label={`Edit ${skill.name}`} title="Edit">
        <IconPencil size={13} stroke={1.5} />
      </button>
      {open && <SkillDialog onClose={() => setOpen(false)} editing={skill} />}
    </>
  );
}

/** Mounted only while open, so `show` always re-seeds from the row being edited. */
function SkillDialog({ onClose, editing }: { onClose: () => void; editing: Skill | null }) {
  const [show, setShow] = useState(editing?.show ?? true);

  return (
    <Dialog open onClose={onClose} title={editing ? "Edit skill" : "Add skill"} icon={IconCpu}>
      <form
        action={async (formData) => {
          if (editing) await updateSkill(editing.id, formData);
          else await createSkill(formData);
          onClose();
        }}
      >
        <div className="f-row">
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="iconKey" label="Icon key" mono defaultValue={editing?.iconKey || ""} required hint="Usually identical to the name." />
        </div>
        {/* Deliberately not a `.f` wrapper: `.f label` would restyle the Switch's
            own caption into the mono field-label face. */}
        <div style={{ marginBottom: 14 }}>
          {/* Single source of truth for `show` — the action reads this one field. */}
          <input type="hidden" name="show" value={show ? "true" : "false"} />
          <Switch
            checked={show}
            onChange={setShow}
            label={show ? "Shown in the skills grid" : "Hidden — stays usable as a tag"}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit">{editing ? "Save changes" : "Create skill"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SkillsTable({ skills }: { skills: Skill[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const groups = groupSkills(skills);

  return (
    <Card flush>
      <CardHead
        title="Skills"
        count={skills.length}
        right={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <IconPlus size={14} /> Add skill
          </Button>
        }
      />

      <div className="card-b">
        {groups.map((g, gi) => (
          <div key={g.key} className="skill-cat" style={gi === groups.length - 1 ? { marginBottom: 0 } : undefined}>
            <div className="skill-cat-h">
              <div className="skill-cat-t">{g.title}</div>
              <div className="skill-cat-n">/ {String(g.rows.length).padStart(2, "0")}</div>
            </div>
            <div className="skill-wrap">
              {g.rows.map(s => <SkillChip key={s.id} skill={s} />)}
            </div>
          </div>
        ))}

        {skills.length === 0 && (
          <div className="empty">
            <div className="empty-ic"><IconCpu size={20} stroke={1.5} /></div>
            <b>No skills yet</b>
            <span>Add the tools you actually work with — they fill the skills grid and become tags on projects and experience.</span>
          </div>
        )}
      </div>

      {addOpen && <SkillDialog onClose={() => setAddOpen(false)} editing={null} />}
    </Card>
  );
}
