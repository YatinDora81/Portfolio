"use client";

import { useRef, useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { IconPicker } from "@/components/shared/icon-picker";
import { createSocialLink, updateSocialLink, deleteSocialLink } from "@/lib/actions/social-links";
import { publishSite } from "@/lib/actions/publish";
import { IconPlus, IconPencil, IconArrowUpRight, IconLink, IconAlertTriangle } from "@tabler/icons-react";
import { findSocialIcon } from "@repo/ui/icons/registry";
import { cn } from "@/lib/utils";

interface Link { id: string; name: string; href: string; iconKey: string; detail: string | null; sortOrder: number }

export function SocialLinksList({ links }: { links: Link[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Link | null>(null);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);

  // Which submit button was pressed. A ref, not state: the click lands in the
  // same event as the submit, so state set here would still be stale by the
  // time the action reads it. `busyRef` is the same story for the second click
  // that arrives before the disabled buttons have re-rendered.
  const wantPublish = useRef(false);
  const busyRef = useRef(false);

  const handleSubmit = async (formData: FormData) => {
    if (busyRef.current) return;
    const publish = wantPublish.current;
    busyRef.current = true;
    setBusy(publish ? "publish" : "save");
    setPubError(null);
    try {
      if (editing) await updateSocialLink(editing.id, formData);
      else await createSocialLink(formData);
      setDialogOpen(false);
      if (publish) {
        // Decision 5: the link is saved. A publish that fails is a separate,
        // retryable failure — it never undoes the write, so the dialog still
        // closes and the reason lands on the card behind it.
        const res = await publishSite();
        if (!res.ok) setPubError(res.error ?? "Could not reach the site.");
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

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

      {pubError && (
        <div className="filters" style={{ alignItems: "center", color: "var(--bad)", fontSize: 12 }}>
          <IconAlertTriangle size={14} stroke={1.6} style={{ flexShrink: 0 }} />
          <span>The link is saved. Publishing failed ({pubError}) — retry with Publish, top right.</span>
        </div>
      )}

      {links.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconLink size={18} stroke={1.5} /></div>
          <b>No links yet</b>
          <span>Add GitHub, LinkedIn or X — they show up in the hero, the contact sidebar and the footer.</span>
        </div>
      ) : (
        <div className="rows">
          {links.map((l, i) => {
            const icon = findSocialIcon(l.iconKey);
            return (
            <div className="row" key={l.id}>
              <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
              <span className="ico-sw ink sm" style={!icon ? { color: "var(--bad)" } : undefined}>
                {icon ? <icon.Icon /> : <IconAlertTriangle size={12} stroke={1.8} />}
              </span>
              <div className="row-main">
                <div className="row-t">{l.name}</div>
                <div className="row-m">{l.href}{l.detail ? ` · ${l.detail}` : ""}</div>
              </div>
              <span className={cn("chip", icon ? "off" : "amb")}>{l.iconKey}</span>
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
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit Link" : "Add Link"}
        icon={IconLink}
      >
        <form action={handleSubmit}>
          <Input name="name" label="Name" defaultValue={editing?.name || ""} required />
          <Input name="href" label="URL" mono defaultValue={editing?.href || ""} required />
          <IconPicker
            key={editing?.id ?? "new"}
            kind="social"
            label="Icon"
            hint="Drawn in the hero, the contact sidebar and the footer."
            defaultValue={editing?.iconKey || ""}
            required
          />
          <Input name="detail" label="Detail (optional)" defaultValue={editing?.detail || ""} />
          <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="outline"
              type="submit"
              disabled={busy !== null}
              onClick={() => { wantPublish.current = false; }}
            >
              {busy === "save" ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
            <Button
              type="submit"
              disabled={busy !== null}
              onClick={() => { wantPublish.current = true; }}
            >
              {busy === "publish" ? "Saving…" : "Save & Publish"}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
