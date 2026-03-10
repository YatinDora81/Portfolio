"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateResumeUrl } from "@/lib/actions/links";
import { IconCheck, IconExternalLink } from "@tabler/icons-react";

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
    <div className="flex gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://drive.google.com/..."
        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
      />
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <IconExternalLink size={16} />
        </a>
      )}
      <Button onClick={handleSave} disabled={pending || url === resumeUrl} size="sm">
        {saved ? (
          <><IconCheck size={16} /> Saved</>
        ) : pending ? (
          "Saving..."
        ) : (
          "Save"
        )}
      </Button>
    </div>
  );
}
