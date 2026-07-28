"use client";

import { useState } from "react";
import { useStaging } from "@/components/staging/staging-provider";
import { cn } from "@/lib/utils";
import { HeroTitlesTable } from "./titles-table";
import { HeroSkillBadgesTable } from "./badges-table";

type Version = "v1" | "v2";

interface Title { id: string; title: string; sortOrder: number; version: string }
interface Badge { id: string; name: string; iconKey: string; sortOrder: number; version: string }

/**
 * One version tab for the whole page. Titles and badges belong to the same hero,
 * so letting each table hold its own tab would let you edit v1's titles beside
 * v2's badges and preview a hero that never ships.
 */
export function HeroSections({ titles, badges, liveVersion, preview }: {
  titles: Title[];
  badges: Badge[];
  liveVersion: Version;
  /** Both panes render on the server; the tab picks which one is shown. */
  preview: Record<Version, React.ReactNode>;
}) {
  const [version, setVersion] = useState<Version>(liveVersion);
  const { overlay } = useStaging();

  // Counted off the staged view so a pending create shows up in the tab it was
  // made on, not only after saving.
  const count = (v: Version) =>
    overlay("heroTitle", titles, (t) => t.id, v).filter((t) => t.version === v).length +
    overlay("heroSkillBadge", badges, (b) => b.id, v).filter((b) => b.version === v).length;

  const tabs: { key: Version; label: string; n: number }[] = [
    { key: "v1", label: liveVersion === "v1" ? "v1 · live" : "v1", n: count("v1") },
    { key: "v2", label: liveVersion === "v2" ? "v2 · live" : "v2", n: count("v2") },
  ];

  return (
    <>
      <div className="filters">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={cn("filt", version === t.key && "on")}
            onClick={() => setVersion(t.key)}
          >
            {t.label} {t.n}
          </button>
        ))}
      </div>

      <HeroTitlesTable titles={titles} version={version} />
      <HeroSkillBadgesTable badges={badges} version={version} />

      {preview[version]}
    </>
  );
}
