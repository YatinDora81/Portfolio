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

/**
 * What a row knows about the last thing it was asked to do.
 *
 * `stale` is the arm that earns the shape, exactly as on the flags page: the
 * status moved and the cache flush did not, so the badge beside it is telling
 * the truth about the database and a lie about what visitors are seeing.
 * Folding it into "done" would hide the only fact worth reporting.
 */
type Outcome =
  | { kind: "done" }
  | { kind: "stale"; error: string }
  | { kind: "link"; url: string }
  | { kind: "failed"; error: string };

export type LifecycleKind = "blog" | "project";

export function RowActions({ kind, id, slug, title, status, previewBlocked }: {
  kind: LifecycleKind;
  id: string;
  /** A blog's slug; null for a project, which has neither slug nor detail page. */
  slug: string | null;
  title: string;
  status: ContentStatus;
  /**
   * Why preview links cannot be minted at all right now, or null when they can.
   * Resolved once on the server per page load rather than discovered by a
   * click: a button that is disabled and says why is a working button, and one
   * that errors after every press is a broken one.
   */
  previewBlocked: string | null;
}) {
  const [busy, setBusy] = useState<"publish" | "preview" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [, start] = useTransition();

  const canPublishNow = status === "SCHEDULED";
  const canPreview = status === "DRAFT" || status === "SCHEDULED";
  if (!canPublishNow && !canPreview) return null;

  /**
   * Every call below is wrapped, and every one clears `busy` in `finally`.
   *
   * The action reports its own refusals as `{ ok: false }`, so a *rejection* is
   * the transport underneath one — most realistically an expired session
   * redirecting the action POST to /login. A throw inside a transition reaches
   * no error boundary, so without the catch the row would sit disabled forever,
   * mid-action, with nothing on screen to say why.
   */
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
          // A project has no slug and no detail page, so its preview is the
          // homepage in draft mode — the only surface a draft project appears on.
          kind === "blog" && slug ? { type: "Blog", slug } : { type: "Home" }
        );
        if (!res.ok || !res.url) {
          setOutcome({ kind: "failed", error: res.error ?? "No preview link was returned." });
          return;
        }
        // The await above has already broken the user-gesture chain, so some
        // browsers will refuse this. The link is kept on screen either way,
        // which is the difference between a blocked popup and a dead button.
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
