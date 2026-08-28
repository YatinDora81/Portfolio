"use client";

import { useState, useTransition } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateResumeUrl } from "@/lib/actions/links";
import { publishSite } from "@/lib/actions/publish";
import { cn } from "@/lib/utils";
import {
  IconAlertTriangle, IconArrowUpRight, IconCheck, IconDeviceFloppy, IconWorldUpload,
} from "@tabler/icons-react";

export function ResumeForm({ resumeUrl }: { resumeUrl: string }) {
  const [url, setUrl] = useState(resumeUrl);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = (publish: boolean) => {
    setBusy(publish ? "publish" : "save");
    setPubError(null);
    setSaveError(null);
    startTransition(async () => {
      try {
        const res = await updateResumeUrl(url);
        if (!res.ok) {
          setSaveError("Your session has expired — sign in again, then save.");
          return;
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        if (publish) {
          const res = await publishSite();
          if (!res.ok) setPubError(res.error ?? "Could not reach the site.");
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const dirty = url !== resumeUrl;

  return (
    <Card flush className={cn(dirty && "cfg-dirty")}>
      <CardHead
        title="Resume / CV"
        right={
          <div className="row-acts" style={{ gap: 6 }}>
            {dirty && <Badge className="amb">unsaved</Badge>}
            {resumeUrl && (
              <a className="btn ghost" href={resumeUrl} target="_blank" rel="noopener noreferrer">
                <IconArrowUpRight size={13} stroke={1.5} className="nudge" /> Open
              </a>
            )}
          </div>
        }
      />

      <div className="card-b" style={{ paddingBottom: 2 }}>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://drive.google.com/..."
          label="Resume URL"
          mono
          hint="Drives the résumé button in the hero, the tape row on the contact dial, and the terminal's resume command. Empty removes all three."
        />
      </div>

      {(pubError || saveError) && (
        <div className="cfg-err">
          <IconAlertTriangle size={14} stroke={1.6} />
          <span>
            {saveError
              ? `Nothing was saved — ${saveError}`
              : `The changes are saved. Publishing failed (${pubError}) — retry with Publish, top right.`}
          </span>
        </div>
      )}

      <div className="cfg-foot">
        <span className="cfg-note" aria-live="polite">
          {saved && !pubError && !saveError ? (
            <span style={{ color: "var(--good)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconCheck size={13} stroke={2} /> Saved
            </span>
          ) : dirty ? (
            <>Unsaved. This card saves on its own — not in the save bar.</>
          ) : (
            <>Saves on its own — not in the save bar.</>
          )}
        </span>
        <Button variant="outline" onClick={() => handleSave(false)} disabled={pending || !dirty}>
          <IconDeviceFloppy size={13} /> {pending && busy === "save" ? "Saving…" : "Save changes"}
        </Button>
        <Button onClick={() => handleSave(true)} disabled={pending || !dirty}>
          <IconWorldUpload size={13} /> {pending && busy === "publish" ? "Saving…" : "Save & Publish"}
        </Button>
      </div>
    </Card>
  );
}
