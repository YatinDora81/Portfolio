"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateResumeUrl } from "@/lib/actions/links";
import { IconCheck, IconDeviceFloppy } from "@tabler/icons-react";

export function ResumeForm({ resumeUrl }: { resumeUrl: string }) {
  const [url, setUrl] = useState(resumeUrl);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    startTransition(async () => {
      await updateResumeUrl(url);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://drive.google.com/..."
        label="Resume URL"
        mono
        hint="Drives the “Resume / CV” button in the hero. Paste a public share link."
      />
      <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8 }}>
        {saved && (
          <span className="hint" style={{ color: "var(--good)" }}>
            <IconCheck size={13} /> Saved
          </span>
        )}
        {!saved && url !== resumeUrl && <span className="hint">Unsaved changes</span>}
        <Button onClick={handleSave} disabled={pending || url === resumeUrl}>
          <IconDeviceFloppy size={13} /> {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
