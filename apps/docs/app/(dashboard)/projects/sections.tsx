"use client";

import { useState } from "react";
import { PreviewFrame, ProjectsPreview } from "@/components/preview";
import { ProjectsLayoutCard } from "./layout-card";
import type { ProjectsVersion } from "@/lib/site-config-keys";

interface PreviewProject {
  title: string;
  summary: string;
  github: string | null;
  live: string | null;
  bullets: string[];
  technologies: string[];
  images: string[];
  logoUrl: string | null;
}

/**
 * The client shell around section 05: the layout choice, then the page's own
 * server-rendered cards, then the pane.
 *
 * `children` is the meter, the drag-reorder grid and the empty state, rendered
 * on the server and handed down — the grid does its own reads, so passing it
 * through here is what keeps it off the client. Only the layout row and the
 * pane need state.
 *
 * The pane follows the DRAFT, not the row: picking a tile has to show what that
 * layout does to these actual projects before anyone commits to it. The frame's
 * label is what stops that being a lie — it says outright when the pane is
 * ahead of the site.
 *
 * No numbered block strip. Hero and Contact number their cards 01, 02, 03; this
 * page is already stamped 05 by its `sec-strip`, and a second, unrelated
 * numbering under it reads as a contradiction.
 */
export function ProjectsSections({ version, previewProjects, children }: {
  /** What the `projectsVersion` row holds right now. */
  version: ProjectsVersion;
  previewProjects: PreviewProject[];
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ProjectsVersion>(version);

  return (
    <>
      {/* `.view` has no gap of its own — the page spaces its own blocks, at 14. */}
      <div style={{ marginBottom: 14 }}>
        <ProjectsLayoutCard saved={version} onPick={setDraft} />
      </div>

      {children}

      <PreviewFrame
        label={`Projects — ${draft}${draft === version ? " · live" : " · draft, not what visitors see"}`}
      >
        <ProjectsPreview version={draft} projects={previewProjects} />
      </PreviewFrame>
    </>
  );
}
