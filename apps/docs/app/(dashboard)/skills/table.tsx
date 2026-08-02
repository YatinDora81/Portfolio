"use client";

import { useMemo, useState } from "react";
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
  IconPlus, IconPencil, IconEye, IconEyeOff, IconCpu,
  IconGripVertical, IconArrowBackUp,
} from "@tabler/icons-react";
import { findSkillIcon } from "@repo/ui/icons/registry";
// The category vocabulary the site's periodic table actually filters on. It
// already lives once in this app (the preview mirrors apps/web's skill-meta.ts,
// which sits behind that app's own `@/` alias), so the admin's clusters can
// never name a chip the site does not draw.
import { CATEGORIES, metaFor, deriveSymbol, type CategoryId } from "@/components/preview/skills";

interface Skill { id: string; name: string; iconKey: string; show: boolean; sortOrder: number }

type Sortable = ReturnType<typeof useSortable>;

function SkillChip({ skill, sortable, muted }: { skill: Skill; sortable: Sortable; muted: boolean }) {
  const { stageUpdate, stageDelete, unstageDelete, isDeleted, isNew, isEdited } = useStaging();
  const icon = findSkillIcon(skill.iconKey);
  const { category, color } = metaFor(skill.name);
  const cluster = CATEGORIES.find(c => c.id === category);

  const gone = isDeleted("skill", skill.id);
  /** Exactly one diff mark per chip: gone beats new beats edited. */
  const mark = gone ? "staged-del"
    : isNew("skill", skill.id) ? "staged-new"
      : isEdited("skill", skill.id) ? "staged-edit"
        : null;

  return (
    <div
      className={cn("skill sortable skl-el", !skill.show && "hid", muted && "skl-mute", mark)}
      // The site's own accent for this cluster, decorative: it paints the 2px
      // hairline and the legend dot only, never any text.
      style={{ ["--cat" as string]: color }}
      title={cluster ? `${skill.name} — ${cluster.label}` : skill.name}
      {...sortable.itemProps(skill.id)}
    >
      <span className="row-grip" title="Drag to reorder" {...sortable.handleProps(skill.id)}>
        <IconGripVertical size={13} />
      </span>
      {/* The glyph the site will actually draw. With no registry entry the site
          falls back to the two-letter element symbol, so that is what shows
          here — a red warning would claim a hole the grid does not have. */}
      <span className={cn("ico-sw sm", !icon && "ink")}>
        {icon
          ? <icon.Icon />
          : <b style={{ fontSize: 10, fontWeight: 800, letterSpacing: "-.02em" }}>{deriveSymbol(skill.name)}</b>}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="skill-n">{skill.name}</div>
        <div className="skl-sym">
          {/* The icon key is only worth surfacing when it diverges from the name
              — that mismatch is what decides which glyph the site renders. */}
          {icon
            ? (skill.iconKey !== skill.name ? skill.iconKey : cluster?.label ?? "")
            : `no icon · draws ${deriveSymbol(skill.name)}`}
        </div>
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
  const [name, setName] = useState(editing?.name ?? "");
  const cluster = CATEGORIES.find(c => c.id === metaFor(name.trim()).category);

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
          <Input
            name="name"
            label="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            // The cluster is derived from the name and never stored, so the only
            // honest place to show it is beside the field that decides it.
            hint={name.trim()
              ? `Filters under “${cluster?.label}” on the site`
              : "The name decides which cluster it filters under"}
          />
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
  const [filter, setFilter] = useState<CategoryId | null>(null);

  // Everything staged for this entity — new chips, pending edits and toggles,
  // the pending drag order — folded onto the server rows, so a toggled skill
  // hops lanes the moment it is clicked rather than after a round trip.
  const staged = overlay("skill", skills, (s) => s.id);

  // One hook over the flat list: `sortOrder` is a single sequence and the site
  // renders it as one continuous grid. Category is a *filter* there, not a
  // folder — which is exactly why it is a filter here too. Clusters as folders
  // would make a cross-cluster drag mean nothing, since the category is derived
  // from the name and cannot be changed by moving a chip.
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

  const grid = ordered.filter(s => s.show);
  const tray = ordered.filter(s => !s.show);

  // Counted over the published grid only — the legend describes what visitors
  // can filter, and a hidden skill is not in that table at all.
  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>();
    for (const s of grid) {
      const { category } = metaFor(s.name);
      m.set(category, (m.get(category) ?? 0) + 1);
    }
    return m;
  }, [grid]);

  const clusters = CATEGORIES.filter(c => (counts.get(c.id) ?? 0) > 0);
  const lit = filter ? counts.get(filter) ?? 0 : grid.length;
  const muted = (name: string) => filter !== null && metaFor(name).category !== filter;

  return (
    <Card flush className="wk-in">
      <CardHead
        title="Periodic table"
        count={ordered.length}
        right={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <IconPlus size={14} /> Add skill
          </Button>
        }
      />

      {ordered.length > 0 && (
        <div className="wk-meter">
          <div className="wk-fig"><b>{grid.length}</b><span>in the grid</span></div>
          <div className="wk-fig">
            <b className={tray.length ? undefined : "q"}>{tray.length}</b><span>hidden · tags only</span>
          </div>
          <div className="wk-fig"><b className="q">{clusters.length}</b><span>clusters</span></div>
          <div className="sp" />
          <span className="hint"><IconGripVertical size={13} /> Drag a chip — position one opens the grid</span>
        </div>
      )}

      {grid.length > 0 && (
        <div className="skl-legend" role="group" aria-label="Highlight one cluster">
          <button
            type="button"
            className="skl-chip"
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
            style={{ ["--cat" as string]: "var(--faint)" }}
          >
            <i aria-hidden="true" /> All <b>{grid.length}</b>
          </button>
          {clusters.map(c => (
            <button
              key={c.id}
              type="button"
              className="skl-chip"
              aria-pressed={filter === c.id}
              onClick={() => setFilter(filter === c.id ? null : c.id)}
              style={{ ["--cat" as string]: c.color }}
            >
              <i aria-hidden="true" /> {c.label} <b>{counts.get(c.id)}</b>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span className="hint" aria-live="polite">
            {filter ? `${lit} of ${grid.length} lit` : "clusters are a filter on the site, not a running order"}
          </span>
        </div>
      )}

      <div className="card-b">
        {grid.length > 0 && (
          <div className="skill-wrap">
            {grid.map(s => (
              <SkillChip key={s.id} skill={s} sortable={sortable} muted={muted(s.name)} />
            ))}
          </div>
        )}

        {tray.length > 0 && (
          <>
            <div className="wk-cut">
              not in the grid <span className="n">/ {String(tray.length).padStart(2, "0")}</span>
            </div>
            <div className="skill-wrap">
              {tray.map(s => (
                <SkillChip key={s.id} skill={s} sortable={sortable} muted={muted(s.name)} />
              ))}
            </div>
          </>
        )}

        {ordered.length === 0 && (
          <div className="empty">
            <div className="empty-ic"><IconCpu size={20} stroke={1.5} /></div>
            <b>The periodic table is empty</b>
            <span>Visitors reach section 03 and find a heading over nothing, and the hero drops its &ldquo;+N more&rdquo; chip.</span>
            <Button size="sm" onClick={() => setAddOpen(true)}><IconPlus size={14} /> Add the first skill</Button>
          </div>
        )}

        {ordered.length > 0 && grid.length === 0 && (
          <div className="empty" style={{ paddingBottom: 6 }}>
            <div className="empty-ic"><IconEyeOff size={19} stroke={1.5} /></div>
            <b>Nothing is published to the grid</b>
            <span>Every skill here is a tag only. Section 03 renders a heading over an empty table.</span>
          </div>
        )}
      </div>

      {addOpen && <SkillDialog onClose={() => setAddOpen(false)} editing={null} />}
    </Card>
  );
}
