"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createHeroSkillBadge, updateHeroSkillBadge, deleteHeroSkillBadge } from "@/lib/actions/hero";
import { IconPlus, IconPencil, IconGripVertical, IconTag, IconAlertTriangle } from "@tabler/icons-react";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { IconPicker } from "@/components/shared/icon-picker";
import { cn } from "@/lib/utils";

interface Badge { id: string; name: string; iconKey: string; sortOrder: number }

const FORM_ID = "hero-badge-form";

export function HeroSkillBadgesTable({ badges }: { badges: Badge[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Badge | null>(null);

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Skill badges"
        count={badges.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add badge
          </Button>
        }
      />

      {badges.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconTag size={18} stroke={1.5} /></div>
          <b>No badges yet</b>
          <span>Badges sit inline in the hero bio. Each one needs a name and an icon key.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first badge</Button>
        </div>
      ) : (
        <div className="rows">
          {badges.map((b, i) => {
            const icon = findSkillIcon(b.iconKey);
            return (
            <div key={b.id} className="row">
              <IconGripVertical size={14} className="row-grip" />
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
                  aria-label={`Edit ${b.name}`}
                  onClick={() => { setEditing(b); setDialogOpen(true); }}
                >
                  <IconPencil size={13} stroke={1.5} />
                </IconButton>
                <DeleteButton label={`"${b.name}"`} onDelete={async () => { await deleteHeroSkillBadge(b.id); }} />
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
          action={async (formData) => {
            if (editing) await updateHeroSkillBadge(editing.id, formData);
            else await createHeroSkillBadge(formData);
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
            hint="The hero bio draws this inline next to the name."
          />
        </form>
      </Dialog>
    </Card>
  );
}
