"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createSocialLink, updateSocialLink, deleteSocialLink } from "@/lib/actions/social-links";
import { IconPlus, IconPencil, IconArrowUpRight, IconLink } from "@tabler/icons-react";

interface Link { id: string; name: string; href: string; iconKey: string; detail: string | null; sortOrder: number }

export function SocialLinksList({ links }: { links: Link[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);

  return (
    <Card flush>
      <CardHead
        title="Social links"
        count={links.length}
        right={
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <IconPlus size={13} /> Add link
          </Button>
        }
      />

      {links.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconLink size={18} stroke={1.5} /></div>
          <b>No links yet</b>
          <span>Add GitHub, LinkedIn or X — they show up in the hero, the contact sidebar and the footer.</span>
        </div>
      ) : (
        <div className="rows">
          {links.map((l, i) => (
            <div className="row" key={l.id}>
              <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
              <div className="row-main">
                <div className="row-t">{l.name}</div>
                <div className="row-m">{l.href}{l.detail ? ` · ${l.detail}` : ""}</div>
              </div>
              <span className="chip off">{l.iconKey}</span>
              <div className="row-acts">
                <a
                  className="ibtn"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${l.name}`}
                >
                  <IconArrowUpRight size={13} stroke={1.5} className="nudge" />
                </a>
                <button
                  className="ibtn"
                  onClick={() => { setEditing(l); setDialogOpen(true); }}
                  aria-label={`Edit ${l.name}`}
                >
                  <IconPencil size={13} stroke={1.5} />
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
        title={editing ? "Edit Link" : "Add Link"}
        icon={IconLink}
      >
        <form action={async (formData) => {
          if (editing) await updateSocialLink(editing.id, formData);
          else await createSocialLink(formData);
          setDialogOpen(false);
        }}>
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="href" label="URL" mono defaultValue={editing?.href || ""} required />
          <Input
            name="iconKey"
            label="Icon Key"
            mono
            hint="Matches the icon the portfolio renders for this link."
            defaultValue={editing?.iconKey || ""}
            required
          />
          <Input name="detail" label="Detail (optional)" defaultValue={editing?.detail || ""} />
          <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Update" : "Create"}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
