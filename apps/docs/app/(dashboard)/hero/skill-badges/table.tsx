"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import {
  IconPlus, IconPencil, IconGripVertical, IconTag, IconAlertTriangle,
  IconChevronUp, IconChevronDown, IconArrowBackUp,
} from "@tabler/icons-react";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { IconPicker } from "@/components/shared/icon-picker";
import { useStaging } from "@/components/staging/staging-provider";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";

type Version = "v1" | "v2";

interface Badge { id: string; name: string; iconKey: string; sortOrder: number; version: string }

const FORM_ID = "hero-badge-form";

export function HeroSkillBadgesTable({ badges, liveVersion, preview }: {
  badges: Badge[];
  liveVersion: Version;
  /** Both panes are rendered on the server; the tab picks which one is shown,
      so the preview under the table is always the hero being edited. */
  preview: Record<Version, React.ReactNode>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Badge | null>(null);
  const [version, setVersion] = useState<Version>(liveVersion);
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited, saving,
  } = useStaging();

  // Nothing here writes to the database — every action stages, and the page
  // renders the staged view so the change is on screen before it is saved.
  // The version scopes the reorder lookup as well: `stageReorder` keeps one
  // pending drag per tab, so an unscoped overlay would apply the other tab's.
  const staged = overlay("heroSkillBadge", badges, (b) => b.id, version);

  // After the overlay, never before: a staged create only carries a version
  // once `overlay` has materialised it, so filtering first strands new rows.
  const mine = staged.filter((b) => b.version === version);

  const { order, handleProps, itemProps } = useSortable(
    mine.map((b) => b.id),
    // sortOrder is dense within a version, so the drag belongs to this tab alone.
    (ids) => stageReorder("heroSkillBadge", ids, version),
    { disabled: saving }
  );

  const byId = new Map(mine.map((b) => [b.id, b] as const));
  const seen = new Set(order);
  // `order` is the drag preview and only re-seeds after a render, so a row
  // staged this tick is appended rather than dropped for a frame.
  const rows = [...order.flatMap((id) => byId.get(id) ?? []), ...mine.filter((b) => !seen.has(b.id))];

  const tabs: { key: Version; label: string; n: number }[] = [
    { key: "v1", label: liveVersion === "v1" ? "v1 · live" : "v1", n: staged.filter((b) => b.version === "v1").length },
    { key: "v2", label: liveVersion === "v2" ? "v2 · live" : "v2", n: staged.filter((b) => b.version === "v2").length },
  ];

  /** One mark per row: on its way out, brand new, or edited. */
  const mark = (id: string) =>
    isDeleted("heroSkillBadge", id) ? "staged-del"
      : isNew("heroSkillBadge", id) ? "staged-new"
        : isEdited("heroSkillBadge", id) ? "staged-edit"
          : null;

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  /**
   * Swap a badge with its neighbour and stage the whole order. Indices are
   * `rows` indices, and `rows` drops ids that no longer exist in `badges` — so
   * it is NOT positionally aligned with `order`. Building the payload from
   * `rows` keeps one index space and can't stage a stale id.
   */
  const move = (from: number, to: number) => {
    const ids = rows.map((b) => b.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder("heroSkillBadge", ids, version);
  };

  return (
    <>
    <Card flush>
      <CardHead
        title="Skill badges"
        count={rows.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add badge
          </Button>
        }
      />

      <div className="filters">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={cn("filt", version === t.key && "on")}
            onClick={() => setVersion(t.key)}
          >
            {t.label} {t.n}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconTag size={18} stroke={1.5} /></div>
          <b>No {version} badges yet</b>
          <span>v1 sets these inline in the hero paragraph, v2 lists them as pills under it. Each one needs a name and an icon.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first badge</Button>
        </div>
      ) : (
        <div className="rows">
          {rows.map((b, i) => {
            const icon = findSkillIcon(b.iconKey);
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
                <div className="row-t mono">{b.name}</div>
                <div className="row-m">{icon ? `icon · ${b.iconKey}` : `no icon for "${b.iconKey}" — renders blank`}</div>
              </div>
              <div className="row-acts">
                <IconButton
                  className="move"
                  aria-label={`Move ${b.name} earlier`}
                  disabled={i === 0 || del || saving}
                  onClick={() => move(i, i - 1)}
                >
                  <IconChevronUp size={13} stroke={1.6} />
                </IconButton>
                <IconButton
                  className="move"
                  aria-label={`Move ${b.name} later`}
                  disabled={i === rows.length - 1 || del || saving}
                  onClick={() => move(i, i + 1)}
                >
                  <IconChevronDown size={13} stroke={1.6} />
                </IconButton>
                {del ? (
                  <IconButton
                    aria-label={`Keep ${b.name}`}
                    title="Undo delete"
                    onClick={() => unstageDelete("heroSkillBadge", b.id)}
                  >
                    <IconArrowBackUp size={13} stroke={1.6} />
                  </IconButton>
                ) : (
                  <>
                    <IconButton
                      aria-label={`Edit ${b.name}`}
                      onClick={() => { setEditing(b); setDialogOpen(true); }}
                    >
                      <IconPencil size={13} stroke={1.5} />
                    </IconButton>
                    <DeleteButton
                      staged
                      newRow={isNew("heroSkillBadge", b.id)}
                      label={`"${b.name}"`}
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
            const name = String(formData.get("name") ?? "").trim();
            const iconKey = String(formData.get("iconKey") ?? "").trim();
            // The server trims too; trimming here keeps the staged preview and
            // the saved row identical. A blank name would fail the whole batch.
            if (!name) return;
            if (editing) stageUpdate("heroSkillBadge", editing.id, { name, iconKey });
            // The column is NOT NULL and the server rejects a create without it.
            else stageCreate("heroSkillBadge", { name, iconKey, version });
            setDialogOpen(false);
          }}
        >
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          {/* Hero badges have no name-fallback on the site — an unknown key here
              renders a blank gap mid-sentence, so pick rather than type. */}
          <IconPicker
            key={editing?.id ?? "new"}
            kind="skill"
            label="Icon"
            defaultValue={editing?.iconKey || ""}
            required
            hint="Drawn beside the badge name — inline in v1's paragraph, in v2's pill row."
          />
        </form>
      </Dialog>
    </Card>
    {preview[version]}
    </>
  );
}
