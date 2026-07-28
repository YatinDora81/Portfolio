"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateResumeUrl } from "@/lib/actions/links";
import { publishSite } from "@/lib/actions/publish";
import { IconAlertTriangle, IconCheck, IconDeviceFloppy, IconWorldUpload } from "@tabler/icons-react";

export function ResumeForm({ resumeUrl }: { resumeUrl: string }) {
  const [url, setUrl] = useState(resumeUrl);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);

  // Saving stopped publishing when `revalidatePortfolio()` left the actions, so
  // without this button the hero's Resume button keeps the old link until
  // someone independently finds Publish in the topbar — and the card right below
  // this one already offers the choice.
  const handleSave = (publish: boolean) => {
    setBusy(publish ? "publish" : "save");
    setPubError(null);
    startTransition(async () => {
      try {
        await updateResumeUrl(url);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        if (publish) {
          // Decision 5: the URL is saved. A publish that fails is a separate,
          // retryable failure — it never undoes the write.
          const res = await publishSite();
          if (!res.ok) setPubError(res.error ?? "Could not reach the site.");
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const clean = url === resumeUrl;

  return (
    <div>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://drive.google.com/..."
        label="Resume URL"
        mono
        hint="Drives the resume button in the hero. Paste a public share link."
      />
      {pubError && (
        <div
          className="hint"
          style={{ color: "var(--bad)", marginBottom: 8, lineHeight: 1.5 }}
        >
          <IconAlertTriangle size={14} stroke={1.6} style={{ flexShrink: 0 }} />
          <span>The URL is saved. Publishing failed ({pubError}) — retry with Publish, top right.</span>
        </div>
      )}
      <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        {saved && !pubError && (
          <span className="hint" style={{ color: "var(--good)" }}>
            <IconCheck size={13} /> Saved
          </span>
        )}
        {!saved && !clean && <span className="hint">Unsaved changes</span>}
        <Button variant="outline" onClick={() => handleSave(false)} disabled={pending || clean}>
          <IconDeviceFloppy size={13} /> {pending && busy === "save" ? "Saving…" : "Save"}
        </Button>
        <Button onClick={() => handleSave(true)} disabled={pending || clean}>
          <IconWorldUpload size={13} /> {pending && busy === "publish" ? "Saving…" : "Save & Publish"}
        </Button>
      </div>
    </div>
  );
}
