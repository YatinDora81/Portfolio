"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { IconPicker } from "@/components/shared/icon-picker";
import { createSocialLink, updateSocialLink, deleteSocialLink } from "@/lib/actions/social-links";
import { IconPlus, IconEdit, IconLink, IconAlertTriangle } from "@tabler/icons-react";
import { findSocialIcon } from "@repo/ui/icons/registry";

interface Link { id: string; name: string; href: string; iconKey: string; detail: string | null; sortOrder: number }

export function SocialLinksTable({ links }: { links: Link[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);

  return (
    <Card flush>
      <CardHead
        title="Social links"
        count={links.length}
        right={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <IconPlus size={13} /> Add link
          </Button>
        }
      />

      {links.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconLink size={19} /></div>
          <b>No links yet</b>
          <span>GitHub first — recruiters click that one.</span>
        </div>
      ) : (
        <div className="rows">
          {links.map((l, i) => (
            <div key={l.id} className="row">
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
              <div className="row-acts">
                <button className="ibtn" onClick={() => { setEditing(l); setDialogOpen(true); }} aria-label={`Edit ${l.name}`}>
                  <IconEdit size={13} />
                </button>
                <DeleteButton label={`"${l.name}"`} onDelete={async () => { await deleteSocialLink(l.id); }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit link" : "Add link"}
        icon={editing ? IconEdit : IconPlus}
      >
        <form action={async (formData) => {
          if (editing) await updateSocialLink(editing.id, formData);
          else await createSocialLink(formData);
          setDialogOpen(false);
        }}>
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
          <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Save changes" : "Add link"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
