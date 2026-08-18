"use client";

import { useCallback } from "react";
import { ConfigCard, type ConfigGroup, type ControlContext } from "@/components/config/config-card";
import { cn } from "@/lib/utils";
import {
  PROJECT_LAYOUTS, toProjectsVersion, type ProjectsVersion,
} from "@/lib/site-config-keys";

/**
 * The one row that decides which of the two Projects layouts visitors get.
 *
 * It is a ConfigCard, not a second save path: `projectsVersion` is a SiteConfig
 * row like any other, so it keeps the card that already owns dirty tracking,
 * Reset, Save and Save & Publish — and, critically, posts only the key it was
 * given. Everything below is one `controls` override, exactly the way the Cat
 * page injects its nap picker.
 *
 * Deliberately NOT hero's split. Hero separates "which version am I editing"
 * from "which version ships" because its two versions have their own titles,
 * badges and copy. Projects has no per-version content at all — the same rows
 * are drawn either way — so there is nothing to edit per version and the tile
 * IS the choice. It becomes real when the card saves.
 */
export function ProjectsLayoutCard({ saved, onPick }: {
  /** What the row currently holds — the tile that gets the live marker. */
  saved: ProjectsVersion;
  /** The draft, so the page's preview pane can follow it before a save. */
  onPick: (v: ProjectsVersion) => void;
}) {
  const handleDraft = useCallback(
    (values: Record<string, string>) => onPick(toProjectsVersion(values["projectsVersion"])),
    [onPick],
  );

  const groups: ConfigGroup[] = [
    {
      title: "Layout",
      blurb: "Two ways to draw the same case studies. Picking one here changes nothing until you save — the pane below follows the pick, the site follows the row.",
      keys: ["projectsVersion"],
    },
  ];

  return (
    <ConfigCard
      groups={groups}
      values={{ projectsVersion: saved }}
      onDraftChange={handleDraft}
      controls={{ projectsVersion: (ctx) => <LayoutTiles ctx={ctx} saved={saved} /> }}
    />
  );
}

function LayoutTiles({ ctx, saved }: { ctx: ControlContext; saved: ProjectsVersion }) {
  const picked = toProjectsVersion(ctx.value);

  return (
    <div className="pvr-grid" role="radiogroup" aria-label="Projects layout">
      {PROJECT_LAYOUTS.map((l) => {
        const on = picked === l.value;
        const live = saved === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={cn("pvr", on && "on")}
            onClick={() => ctx.set(l.value)}
          >
            <span className="pvr-k">{l.value}</span>
            <span className="pvr-m">
              <span className="pvr-n">{l.name}</span>
              <span className={cn("pvr-st", live && "live")}>
                {live
                  ? "live on the site"
                  : on
                    ? "picked — goes live when you save"
                    : "not in use"}
              </span>
              <span className="pvr-d">{l.detail}</span>
            </span>
            {/* Repeats the tile's own state at the right edge, where a reader
                scanning for "what do visitors get" stops. */}
            {live && <span className="dot" aria-hidden="true" style={{ background: "var(--good)" }} />}
          </button>
        );
      })}
    </div>
  );
}
