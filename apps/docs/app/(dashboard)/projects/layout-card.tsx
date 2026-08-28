"use client";

import { useCallback } from "react";
import { ConfigCard, type ConfigGroup, type ControlContext } from "@/components/config/config-card";
import { cn } from "@/lib/utils";
import {
  PROJECT_LAYOUTS, toProjectsVersion, type ProjectsVersion,
} from "@/lib/site-config-keys";

export function ProjectsLayoutCard({ saved, onPick }: {
  saved: ProjectsVersion;
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
            {live && <span className="dot" aria-hidden="true" style={{ background: "var(--good)" }} />}
          </button>
        );
      })}
    </div>
  );
}
