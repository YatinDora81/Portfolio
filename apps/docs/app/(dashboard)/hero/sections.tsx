"use client";

import { useState } from "react";
import { useStaging } from "@/components/staging/staging-provider";
import { cn } from "@/lib/utils";
import { HeroTitlesTable } from "./titles-table";
import { HeroSkillBadgesTable } from "./badges-table";
import { HeroCopyCard } from "./copy-card";
import { useLiveVersion, type HeroContentRow } from "@/components/staging/hero-live";

type Version = "v1" | "v2";

interface Title { id: string; title: string; sortOrder: number; version: string }
interface Badge { id: string; name: string; iconKey: string; sortOrder: number; version: string }

/**
 * One version tab for the whole page. Copy, titles and badges belong to the same
 * hero, so letting each table hold its own tab would let you edit v1's titles
 * beside v2's badges and preview a hero that never ships.
 */
export function HeroSections({ titles, badges, content, preview }: {
  titles: Title[];
  badges: Badge[];
  content: HeroContentRow[];
  /** Both panes render on the server; the tab picks which one is shown. */
  preview: Record<Version, React.ReactNode>;
}) {
  const { overlay, isDeleted } = useStaging();
  // Moves the instant a flip is staged, so "· live" tracks what this batch will
  // publish rather than what the database currently says.
  const liveVersion = useLiveVersion(content);
  // Seeded once, deliberately: the tab is a view filter, not a second way to
  // choose which version ships.
  const [version, setVersion] = useState<Version>(liveVersion);

  // Counted off the staged view so a pending create shows up in the tab it was
  // made on, not only after saving.
  const titleCount = (v: Version) =>
    overlay("heroTitle", titles, (t) => t.id, v)
      .filter((t) => t.version === v && !isDeleted("heroTitle", t.id)).length;
  const badgeCount = (v: Version) =>
    overlay("heroSkillBadge", badges, (b) => b.id, v)
      .filter((b) => b.version === v && !isDeleted("heroSkillBadge", b.id)).length;

  const tabs: { key: Version; label: string; n: number }[] = [
    { key: "v1", label: liveVersion === "v1" ? "v1 · live" : "v1", n: titleCount("v1") + badgeCount("v1") },
    { key: "v2", label: liveVersion === "v2" ? "v2 · live" : "v2", n: titleCount("v2") + badgeCount("v2") },
  ];

  // Staging makes the flip atomic with the rows it depends on, but nothing stops
  // a hero from having no role line at all — either by flipping to a version
  // nobody has written a title for, or by emptying the titles of the version
  // already live. Deliberately direction-neutral: the second case is the more
  // dangerous one, since it needs no flip to reach visitors.
  const flipBlockedReason =
    titleCount(version) === 0
      ? `Add a ${version} role title — the line under your name would be empty.`
      : undefined;

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

      <HeroCopyCard content={content} version={version} flipBlockedReason={flipBlockedReason} />
      <HeroTitlesTable titles={titles} version={version} />
      <HeroSkillBadgesTable badges={badges} version={version} />

      {preview[version]}
    </>
  );
}
