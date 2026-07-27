"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DeleteButton } from "@/components/shared/delete-button";
import { IconPicker } from "@/components/shared/icon-picker";
import { useStaging } from "@/components/staging/staging-provider";
import { useSortable } from "@/lib/use-sortable";
import {
  IconPlus, IconPencil, IconEye, IconEyeOff, IconCpu, IconAlertTriangle,
  IconGripVertical, IconArrowBackUp,
} from "@tabler/icons-react";
import { findSkillIcon } from "@repo/ui/icons/registry";

interface Skill { id: string; name: string; iconKey: string; show: boolean; sortOrder: number }

type Sortable = ReturnType<typeof useSortable>;

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

function SkillChip({ skill, sortable }: { skill: Skill; sortable: Sortable }) {
  const { stageUpdate, stageDelete, unstageDelete, isDeleted, isNew, isEdited } = useStaging();
  const icon = findSkillIcon(skill.iconKey);

  const gone = isDeleted("skill", skill.id);
  /** Exactly one diff mark per chip: gone beats new beats edited. */
  const mark = gone ? "staged-del"
    : isNew("skill", skill.id) ? "staged-new"
      : isEdited("skill", skill.id) ? "staged-edit"
        : null;

  return (
    <div className={cn("skill sortable", !skill.show && "hid", mark)} {...sortable.itemProps(skill.id)}>
      <span className="row-grip" title="Drag to reorder" {...sortable.handleProps(skill.id)}>
        <IconGripVertical size={13} />
      </span>
      {/* The glyph the site will actually draw — a broken key reads as a warning
          here instead of as an empty gap on the live page. */}
      <span className={cn("ico-sw sm", !icon && "ink")} style={!icon ? { color: "var(--bad)" } : undefined}>
        {icon ? <icon.Icon /> : <IconAlertTriangle size={12} stroke={1.8} />}
      </span>
      <div>
        <div className="skill-n">{skill.name}</div>
        {/* Only worth surfacing when it diverges from the name — that mismatch is
            what decides which icon the site renders. */}
        {skill.iconKey !== skill.name && <div className="skill-u">{skill.iconKey}</div>}
      </div>
      {gone ? (
        // The chip stays put, struck through, until the bar commits — so the undo
        // takes the place of the controls that are no longer meaningful.
        <button
          className="ibtn"
          aria-label={`Keep ${skill.name}`}
          title="Undo delete"
          onClick={() => unstageDelete("skill", skill.id)}
        >
          <IconArrowBackUp size={13} stroke={1.5} />
        </button>
      ) : (
        <>
          <button
            className="ibtn"
            aria-label={skill.show ? `Hide ${skill.name}` : `Show ${skill.name}`}
            title={skill.show ? "Hide from the grid" : "Show in the grid"}
            onClick={() => stageUpdate("skill", skill.id, { show: !skill.show })}
          >
            {skill.show ? <IconEye size={13} stroke={1.5} /> : <IconEyeOff size={13} stroke={1.5} />}
          </button>
          <SkillEditButton skill={skill} />
          <DeleteButton
            staged
            newRow={isNew("skill", skill.id)}
            label={`"${skill.name}"`}
            sub="This also drops it from every project and experience it's tagged on."
            onDelete={() => stageDelete("skill", skill.id)}
          />
        </>
      )}
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
  const { stageCreate, stageUpdate } = useStaging();
  const [show, setShow] = useState(editing?.show ?? true);

  return (
    <Dialog open onClose={onClose} title={editing ? "Edit skill" : "Add skill"} icon={IconCpu}>
      <form
        action={(formData) => {
          // A staged create has to carry every field the chip renders, since the
          // overlay materialises the pending row out of exactly this bag.
          const fields = {
            name: String(formData.get("name") ?? ""),
            iconKey: String(formData.get("iconKey") ?? ""),
            show,
          };
          // Editing a row that is itself a pending create folds into that create
          // — the store keys on the id either way, tempId included.
          if (editing) stageUpdate("skill", editing.id, fields);
          else stageCreate("skill", fields);
          onClose();
        }}
      >
        <div className="f-row">
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <IconPicker
            kind="skill"
            label="Icon"
            defaultValue={editing?.iconKey || ""}
            required
            hint="Usually the same as the name — browse them all under Icon library."
          />
        </div>
        {/* Deliberately not a `.f` wrapper: `.f label` would restyle the Switch's
            own caption into the mono field-label face. Single source of truth for
            `show` — this state is what gets staged, so no mirror field. */}
        <div style={{ marginBottom: 14 }}>
          <Switch
            checked={show}
            onChange={setShow}
            label={show ? "Shown in the skills grid" : "Hidden — stays usable as a tag"}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          {/* Not "Save": this only puts the chip in the list. The save bar writes. */}
          <Button type="submit">{editing ? "Update skill" : "Add skill"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SkillsTable({ skills }: { skills: Skill[] }) {
  const { overlay, stageReorder } = useStaging();
  const [addOpen, setAddOpen] = useState(false);

  // Everything staged for this entity — new chips, pending edits and toggles,
  // the pending drag order — folded onto the server rows, so a toggled skill
  // hops groups the moment it is clicked rather than after a round trip.
  const staged = overlay("skill", skills, (s) => s.id);

  // One hook over the flat list, not one per group: `sortOrder` is a single
  // sequence across both groups, and staging keeps exactly one reorder op per
  // entity. Re-grouping the dragged order is what pulls a chip back into its own
  // group if the drop crossed the divider.
  const sortable = useSortable(
    staged.map((s) => s.id),
    (ids) => stageReorder("skill", ids)
  );

  // Sorted BY the drag order rather than mapped THROUGH it: the hook re-seeds in
  // an effect, so for one render after a create its `order` has no slot for the
  // new chip — mapping through it would blink the chip out of existence.
  const rank = new Map(sortable.order.map((id, i) => [id, i] as const));
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...staged].sort((a, b) => at(a.id) - at(b.id));
  const groups = groupSkills(ordered);

  return (
    <Card flush>
      <CardHead
        title="Skills"
        count={ordered.length}
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
              {g.rows.map(s => <SkillChip key={s.id} skill={s} sortable={sortable} />)}
            </div>
          </div>
        ))}

        {ordered.length === 0 && (
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
