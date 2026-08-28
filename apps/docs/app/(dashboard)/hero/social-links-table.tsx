"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { IconPicker } from "@/components/shared/icon-picker";
import { useStaging } from "@/components/staging/staging-provider";
import type { Entity } from "@/lib/actions/staging";
import { useSortable } from "@/lib/use-sortable";
import { cn } from "@/lib/utils";
import {
  IconPlus, IconEdit, IconLink, IconAlertTriangle, IconGripVertical, IconArrowBackUp,
  IconChevronUp, IconChevronDown, IconArrowUpRight,
} from "@tabler/icons-react";
import { findSocialIcon } from "@repo/ui/icons/registry";

interface Link {
  id: string; name: string; href: string; iconKey: string; detail: string | null; sortOrder: number;
  /** NULL = every hero version. */
  version: string | null;
}

const ENTITY: Entity = "socialLink";

export function SocialLinksTable({ links }: { links: Link[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);
  const {
    overlay, stageCreate, stageUpdate, stageDelete, unstageDelete, stageReorder,
    isDeleted, isNew, isEdited,
  } = useStaging();

  const staged = overlay(ENTITY, links, (l) => l.id);
  const { order, handleProps, itemProps } = useSortable(
    staged.map((l) => l.id),
    (ids) => stageReorder(ENTITY, ids)
  );
  // sorted by drag order; the hook re-seeds one render late
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rows = [...staged].sort((a, b) => at(a.id) - at(b.id));

  const move = (from: number, to: number) => {
    const ids = rows.map((l) => l.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    stageReorder(ENTITY, ids);
  };

  return (
    <Card flush>
      <CardHead
        title="Social links"
        count={rows.filter((l) => !isDeleted(ENTITY, l.id)).length}
        right={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <IconPlus size={13} /> Add link
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconLink size={19} /></div>
          <b>No links yet</b>
          <span>The hero draws no icon row, the contact dial has no frequencies, and the footer no socials.</span>
        </div>
      ) : (
        <div className="rows">
          {rows.map((l, i) => {
            const del = isDeleted(ENTITY, l.id);
            const mark = del
              ? "staged-del"
              : isNew(ENTITY, l.id) ? "staged-new" : isEdited(ENTITY, l.id) ? "staged-edit" : null;
            return (
              <div key={l.id} className={cn("row sortable", mark)} {...itemProps(l.id)}>
                <span className="row-grip" title="Drag to reorder" {...handleProps(l.id)}>
                  <IconGripVertical size={14} />
                </span>
                <span className="row-i">{String(i + 1).padStart(2, "0")}</span>
                <span className="ico-sw ink sm" style={!findSocialIcon(l.iconKey) ? { color: "var(--bad)" } : undefined}>
                  {(() => { const e = findSocialIcon(l.iconKey); return e ? <e.Icon /> : <IconAlertTriangle size={12} stroke={1.8} />; })()}
                </span>
                <div className="row-main">
                  <div className="row-t">{l.name}</div>
                  <div className="row-m">
                    {l.href}
                    <span style={{ color: "var(--faint)" }}> · {l.iconKey}</span>
                    {l.detail ? ` · ${l.detail}` : ""}
                  </div>
                </div>
                {l.version ? <span className="chip off">{l.version} hero only</span> : null}
                <div className="row-acts">
                  {del ? (
                    <IconButton
                      aria-label={`Keep ${l.name}`}
                      title="Undo delete"
                      onClick={() => unstageDelete(ENTITY, l.id)}
                    >
                      <IconArrowBackUp size={13} stroke={1.5} />
                    </IconButton>
                  ) : (
                    <>
                      <a
                        className="ibtn"
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${l.name}`}
                        title="Open in a new tab"
                      >
                        <IconArrowUpRight size={13} stroke={1.5} className="nudge" />
                      </a>
                      <IconButton
                        className="move"
                        aria-label={`Move ${l.name} earlier`}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        <IconChevronUp size={13} stroke={1.6} />
                      </IconButton>
                      <IconButton
                        className="move"
                        aria-label={`Move ${l.name} later`}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <IconChevronDown size={13} stroke={1.6} />
                      </IconButton>
                      <IconButton onClick={() => { setEditing(l); setDialogOpen(true); }} aria-label={`Edit ${l.name}`}>
                        <IconEdit size={13} />
                      </IconButton>
                      <DeleteButton
                        staged
                        newRow={isNew(ENTITY, l.id)}
                        label={`"${l.name}"`}
                        onDelete={() => stageDelete(ENTITY, l.id)}
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
        title={editing ? "Edit link" : "Add link"}
        icon={editing ? IconEdit : IconPlus}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const fields = {
              name: String(data.get("name") ?? ""),
              href: String(data.get("href") ?? ""),
              iconKey: String(data.get("iconKey") ?? ""),
              detail: String(data.get("detail") ?? ""),
              // blank must be null, not "": readers test `== null`
              version: data.get("version") ? String(data.get("version")) : null,
            };
            if (editing) stageUpdate(ENTITY, editing.id, fields);
            else stageCreate(ENTITY, fields);
            setDialogOpen(false);
          }}
        >
          <Input name="name" label="Name" placeholder="e.g. GitHub" defaultValue={editing?.name || ""} required />
          <Input name="href" label="URL" mono placeholder="https://…" defaultValue={editing?.href || ""} required />
          <IconPicker
            key={editing?.id ?? "new"}
            kind="social"
            label="Icon"
            hint="Drawn in the hero, the contact sidebar and the footer."
            defaultValue={editing?.iconKey || ""}
            required
          />
          <Input name="detail" label="Detail (optional)" placeholder="@handle" defaultValue={editing?.detail || ""} />
          <Select
            name="version"
            label="Show in hero"
            defaultValue={editing?.version || ""}
            options={[
              { value: "", label: "Both versions" },
              { value: "v1", label: "v1 only" },
              { value: "v2", label: "v2 only" },
            ]}
            hint="Only the hero honours this. The contact section, the footer and the structured data list every link whichever version is live."
          />
          <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update link" : "Add link"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
