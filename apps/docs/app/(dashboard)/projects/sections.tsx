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

export function ProjectsSections({ version, previewProjects, children }: {
  version: ProjectsVersion;
  previewProjects: PreviewProject[];
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ProjectsVersion>(version);

  return (
    <>
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
