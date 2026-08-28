"use client";

import { useState, useTransition } from "react";
import type { ContentStatus } from "db";
import { Button } from "@/components/ui/button";
import { publishBlogNow, publishProjectNow } from "@/lib/actions/publishing";
import { createPreviewLink } from "@/lib/actions/preview-link";
import { transportError } from "@/lib/lifecycle";
import {
  IconAlertTriangle, IconCircleCheck, IconEye, IconRefresh, IconRocket,
} from "@tabler/icons-react";

// stale = the status moved but the flush did not
type Outcome =
  | { kind: "done" }
  | { kind: "stale"; error: string }
  | { kind: "link"; url: string }
  | { kind: "failed"; error: string };

export type LifecycleKind = "blog" | "project";

export function RowActions({ kind, id, slug, title, status, previewBlocked }: {
  kind: LifecycleKind;
  id: string;
  slug: string | null;
  title: string;
  status: ContentStatus;
  previewBlocked: string | null;
}) {
  const [busy, setBusy] = useState<"publish" | "preview" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [, start] = useTransition();

  const canPublishNow = status === "SCHEDULED";
  const canPreview = status === "DRAFT" || status === "SCHEDULED";
  if (!canPublishNow && !canPreview) return null;

  // a throw inside a transition reaches no error boundary
  const publishNow = () => {
    setBusy("publish");
    setOutcome(null);
    start(async () => {
      try {
        const res = kind === "blog" ? await publishBlogNow(id) : await publishProjectNow(id);
        if (!res.ok) {
          setOutcome({ kind: "failed", error: res.error ?? "It was not published." });
          return;
        }
        setOutcome(
          res.revalidated
            ? { kind: "done" }
            : { kind: "stale", error: res.revalidateError ?? "The flush failed, and returned no error text." }
        );
      } catch (e) {
        setOutcome({ kind: "failed", error: transportError(e) });
      } finally {
        setBusy(null);
      }
    });
  };

  const preview = () => {
    setBusy("preview");
    setOutcome(null);
    start(async () => {
      try {
        const res = await createPreviewLink(
          kind === "blog" && slug ? { type: "Blog", slug } : { type: "Home" }
        );
        if (!res.ok || !res.url) {
          setOutcome({ kind: "failed", error: res.error ?? "No preview link was returned." });
          return;
        }
        // the await broke the gesture chain, so this may be blocked
        window.open(res.url, "_blank", "noopener,noreferrer");
        setOutcome({ kind: "link", url: res.url });
      } catch (e) {
        setOutcome({ kind: "failed", error: transportError(e) });
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="lc-acts">
      <div className="lc-btns">
        {canPublishNow ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={publishNow}
            title={`Publish "${title}" immediately instead of waiting`}
          >
            {busy === "publish"
              ? <><IconRefresh size={13} className="spin" /> Publishing…</>
              : <><IconRocket size={13} stroke={1.6} /> Publish now</>}
          </Button>
        ) : null}

        {canPreview ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || previewBlocked !== null}
            onClick={preview}
            title={previewBlocked ?? `Open "${title}" in draft mode`}
          >
            {busy === "preview"
              ? <><IconRefresh size={13} className="spin" /> Minting…</>
              : <><IconEye size={13} stroke={1.6} /> Preview</>}
          </Button>
        ) : null}
      </div>

      {previewBlocked && canPreview ? (
        <div className="lc-note">{previewBlocked}</div>
      ) : null}

      {outcome?.kind === "done" ? (
        <div className="rv-ok"><IconCircleCheck size={12} stroke={1.8} /> published · live from the next visit</div>
      ) : null}

      {outcome?.kind === "stale" ? (
        <div className="fl-warn">
          <b><IconAlertTriangle size={13} stroke={1.7} /> Published, but the site was not flushed</b>
          The badge above is what the database says. Visitors keep seeing the old page until the
          cache clears on its own — flush it by hand from Revalidation. The write is done; do not
          publish again.
          <span>{outcome.error}</span>
        </div>
      ) : null}

      {outcome?.kind === "link" ? (
        <div className="lc-note">
          Preview link minted.{" "}
          <a href={outcome.url} target="_blank" rel="noreferrer">Open it</a>{" "}
          if the new tab was blocked.
        </div>
      ) : null}

      {outcome?.kind === "failed" ? (
        <div className="rv-err">{outcome.error}</div>
      ) : null}
    </div>
  );
}
