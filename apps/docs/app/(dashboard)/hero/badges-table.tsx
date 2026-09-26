"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import {
  IconPlus, IconPencil, IconGripVertical, IconTag, IconAlertTriangle,
  IconChevronUp, IconChevronDown, IconArrowBackUp,
} from "@tabler/icons-react";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { useStaging } from "@/components/staging/staging-provider";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

type Version = "v1" | "v2";

interface Badge { id: string; skillId: string; label: string | null; sortOrder: number; version: string }
interface Skill { id: string; name: string; iconKey: string }

const FORM_ID = "hero-badge-form";

export function HeroSkillBadgesTable({ badges, skills, version }: {
  badges: Badge[];
  skills: Skill[];
  version: Version;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Badge | null>(null);
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited, saving,
  } = useStaging();

  const staged = overlay("heroSkillBadge", badges, (b) => b.id, version);

  // filter after the overlay, or staged creates get stranded
  const mine = staged.filter((b) => b.version === version);

  const { order, handleProps, itemProps } = useSortable(
    mine.map((b) => b.id),
    (ids) => stageReorder("heroSkillBadge", ids, version),
    { disabled: saving }
  );

  const byId = new Map(mine.map((b) => [b.id, b] as const));
  const seen = new Set(order);
  const rows = [...order.flatMap((id) => byId.get(id) ?? []), ...mine.filter((b) => !seen.has(b.id))];

  const skillById = new Map(skills.map((s) => [s.id, s] as const));

  const mark = (id: string) =>
    isDeleted("heroSkillBadge", id) ? "staged-del"
      : isNew("heroSkillBadge", id) ? "staged-new"
        : isEdited("heroSkillBadge", id) ? "staged-edit"
          : null;

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  const move = (from: number, to: number) => {
    const ids = rows.map((b) => b.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder("heroSkillBadge", ids, version);
  };

  const taken = new Set(rows.filter((b) => b.id !== editing?.id).map((b) => b.skillId));
  const available = skills.filter((s) => !taken.has(s.id) || s.id === editing?.skillId);

  return (
    <Card flush>
      <CardHead
        title="Skill badges"
        count={rows.length}
        right={
          <Button size="sm" onClick={openNew} disabled={available.length === 0}>
            <IconPlus size={14} stroke={1.8} /> Add badge
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconTag size={18} stroke={1.5} /></div>
          <b>No {version} badges yet</b>
          <span>v1 sets these inline in the hero paragraph, v2 lists them as pills under it. Each one points at a skill and borrows its name and icon.</span>
          <Button size="sm" onClick={openNew} disabled={available.length === 0}>
            <IconPlus size={14} stroke={1.8} /> Add the first badge
          </Button>
        </div>
      ) : (
        <div className="rows">
          {rows.map((b, i) => {
            const skill = skillById.get(b.skillId);
            const name = b.label ?? skill?.name ?? "";
            const icon = findSkillIcon(skill?.iconKey ?? "");
            const del = isDeleted("heroSkillBadge", b.id);
            return (
            <div key={b.id} className={cn("row sortable", mark(b.id))} {...itemProps(b.id)}>
              <span className="row-grip" title="Drag to reorder" {...handleProps(b.id)}>
                <IconGripVertical size={14} />
              </span>
              <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
              <span className={cn("ico-sw sm", !icon && "ink")} style={!icon ? { color: "var(--bad)" } : undefined}>
                {icon ? <icon.Icon /> : <IconAlertTriangle size={12} stroke={1.8} />}
              </span>
              <div className="row-main">
                <div className="row-t mono">{name}</div>
                <div className="row-m">
                  {!skill
                    ? "the skill behind this badge is gone — pick another"
                    : b.label !== null
                      ? `renamed from ${skill.name} · icon ${skill.iconKey}`
                      : icon ? `skill · icon ${skill.iconKey}` : `no icon for "${skill.iconKey}" — renders blank`}
                </div>
              </div>
              <div className="row-acts">
                <IconButton
                  className="move"
                  aria-label={`Move ${name} earlier`}
                  disabled={i === 0 || del || saving}
                  onClick={() => move(i, i - 1)}
                >
                  <IconChevronUp size={13} stroke={1.6} />
                </IconButton>
                <IconButton
                  className="move"
                  aria-label={`Move ${name} later`}
                  disabled={i === rows.length - 1 || del || saving}
                  onClick={() => move(i, i + 1)}
                >
                  <IconChevronDown size={13} stroke={1.6} />
                </IconButton>
                {del ? (
                  <IconButton
                    aria-label={`Keep ${name}`}
                    title="Undo delete"
                    onClick={() => unstageDelete("heroSkillBadge", b.id)}
                  >
                    <IconArrowBackUp size={13} stroke={1.6} />
                  </IconButton>
                ) : (
                  <>
                    <IconButton
                      aria-label={`Edit ${name}`}
                      onClick={() => { setEditing(b); setDialogOpen(true); }}
                    >
                      <IconPencil size={13} stroke={1.5} />
                    </IconButton>
                    <DeleteButton
                      staged
                      newRow={isNew("heroSkillBadge", b.id)}
                      label={`"${name}"`}
                      onDelete={() => stageDelete("heroSkillBadge", b.id)}
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
        title={editing ? "Edit badge" : "Add badge"}
        icon={IconTag}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Save changes" : "Create badge"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={(formData) => {
            const skillId = String(formData.get("skillId") ?? "");
            const typed = String(formData.get("label") ?? "").trim();
            if (!skillId) return;
            const label = typed === "" || typed === skillById.get(skillId)?.name ? null : typed;
            if (editing) stageUpdate("heroSkillBadge", editing.id, { skillId, label });
            else stageCreate("heroSkillBadge", { skillId, label, version });
            setDialogOpen(false);
          }}
        >
          <Select
            name="skillId"
            label="Skill"
            defaultValue={editing?.skillId ?? ""}
            required
            options={available.map((s) => ({ value: s.id, label: `${s.name} · ${s.iconKey}` }))}
            hint={available.length === 0
              ? "Every skill already has a badge in this version."
              : "The badge takes this skill's name and icon, and follows it when the skill is renamed."}
          />
          <Input
            name="label"
            label="Label override"
            defaultValue={editing?.label ?? ""}
            placeholder="leave blank to use the skill's name"
            hint="Only for a badge that has to read differently from the skill — Golang over Go."
          />
        </form>
      </Dialog>
    </Card>
  );
}
