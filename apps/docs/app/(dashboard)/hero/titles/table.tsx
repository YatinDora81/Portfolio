"use client";

import { useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { createHeroTitle, updateHeroTitle, deleteHeroTitle } from "@/lib/actions/hero";
import { IconPlus, IconPencil, IconGripVertical, IconSparkles } from "@tabler/icons-react";

interface Title { id: string; title: string; sortOrder: number }

const FORM_ID = "hero-title-form";

export function HeroTitlesTable({ titles }: { titles: Title[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Title | null>(null);

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <Card flush>
      <CardHead
        title="Rotating titles"
        count={titles.length}
        right={
          <Button size="sm" onClick={openNew}>
            <IconPlus size={14} stroke={1.8} /> Add title
          </Button>
        }
      />

      {titles.length === 0 ? (
        <div className="empty">
          <div className="empty-ic"><IconSparkles size={18} stroke={1.5} /></div>
          <b>No titles yet</b>
          <span>The hero cycles through these one after another, right under your name.</span>
          <Button size="sm" onClick={openNew}><IconPlus size={14} stroke={1.8} /> Add the first title</Button>
        </div>
      ) : (
        <div className="rows">
          {titles.map((t, i) => (
            <div key={t.id} className="row">
              <IconGripVertical size={14} className="row-grip" />
              <div className="row-i">{String(i + 1).padStart(2, "0")}</div>
              <div className="row-main">
                <div className="row-t">{t.title}</div>
              </div>
              <div className="row-acts">
                <IconButton
                  aria-label={`Edit ${t.title}`}
                  onClick={() => { setEditing(t); setDialogOpen(true); }}
                >
                  <IconPencil size={13} stroke={1.5} />
                </IconButton>
                <DeleteButton label={`"${t.title}"`} onDelete={async () => { await deleteHeroTitle(t.id); }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Edit title" : "Add title"}
        icon={IconSparkles}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form={FORM_ID}>{editing ? "Save changes" : "Create title"}</Button>
          </>
        }
      >
        <form
          id={FORM_ID}
          action={async (formData) => {
            if (editing) await updateHeroTitle(editing.id, formData);
            else await createHeroTitle(formData);
            setDialogOpen(false);
          }}
        >
          <Input
            name="title"
            label="Title"
            defaultValue={editing?.title || ""}
            required
            hint="Shown one at a time in the hero rotator — a few words reads best."
          />
        </form>
      </Dialog>
    </Card>
  );
}
