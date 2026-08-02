"use client";

import { useCallback, useState } from "react";
import { useStaging } from "@/components/staging/staging-provider";
import { StagedHeroPreview } from "@/components/preview/staged";
import { ConfigCard, type ConfigGroup } from "@/components/config/config-card";
import { Borrowed } from "@/components/shared/borrowed";
import { useLiveVersion, type HeroContentRow } from "@/components/staging/hero-live";
import { HeroTitlesTable } from "./titles-table";
import { HeroSkillBadgesTable } from "./badges-table";
import { HeroCopyCard } from "./copy-card";
import { HeroVersionCard, type Version } from "./version-card";
import { SocialLinksTable } from "./social-links-table";
import { ResumeForm } from "./resume-form";

interface Title { id: string; title: string; sortOrder: number; version: string }
interface Badge { id: string; name: string; iconKey: string; sortOrder: number; version: string }
interface Social {
  id: string; name: string; href: string; iconKey: string; detail: string | null;
  sortOrder: number; version: string | null;
}

/**
 * The whole hero on one screen, in the order the section is built:
 *
 *   01 Version · 02 Headline & copy · 03 Identity · 04 Status dot ·
 *   05 Social row · 06 Résumé · preview
 *
 * Three storage layers meet here and each keeps the writer it already had,
 * which is the only reason the consolidation is safe: the tables stage into the
 * save bar, the SiteConfig keys go through ConfigCard's own footer, and the
 * résumé URL keeps `updateResumeUrl` — SiteConfig's one row with a second
 * writer (see lib/actions/links.ts). The numbered strips are what keeps that
 * legible: nobody should have to guess which Save applies to what they typed.
 *
 * One version tab governs the page. Copy, titles and badges belong to the same
 * hero, so letting each table hold its own tab would let you edit v1's titles
 * beside v2's badges and preview a hero that never ships.
 */
export function HeroSections({
  titles, badges, content, socialLinks, config, resumeUrl, availabilityStatus, totalSkills,
}: {
  titles: Title[];
  badges: Badge[];
  content: HeroContentRow[];
  socialLinks: Social[];
  /** Exactly the SiteConfig keys this section owns — the ConfigCard payload. */
  config: Record<string, string>;
  /** Written by `updateResumeUrl`, deliberately not a ConfigCard key. */
  resumeUrl: string;
  /** Owned by Contact. Shown here read-only, and passed to the pane so it draws
      the pill visitors actually get. */
  availabilityStatus: string;
  totalSkills: number;
}) {
  const { overlay, isDeleted } = useStaging();
  // Moves the instant a flip is staged, so "live" tracks what this batch will
  // publish rather than what the database currently says.
  const liveVersion = useLiveVersion(content);
  // Seeded once, deliberately: the tab is a view filter, not a second way to
  // choose which version ships.
  const [version, setVersion] = useState<Version>(liveVersion);

  // The config fields as they are being typed, so the pane at the bottom moves
  // with them instead of waiting for a save. ConfigCard still owns the values —
  // this is a copy for drawing, and it is never posted from here.
  const [draft, setDraft] = useState<Record<string, string>>(config);
  const onDraftChange = useCallback((v: Record<string, string>) => setDraft(v), []);

  // Counted off the staged view so a pending create shows up in the tab it was
  // made on, not only after saving.
  const countIn = (
    entity: "heroTitle" | "heroSkillBadge",
    rows: { id: string; version: string }[],
    v: Version,
  ) => overlay(entity, rows, (r) => r.id, v)
    .filter((r) => r.version === v && !isDeleted(entity, r.id)).length;

  // NULL version means "every hero", so such a row counts for both tiles.
  const socialCount = (v: Version) =>
    overlay("socialLink", socialLinks, (l) => l.id)
      .filter((l) => (l.version === v || l.version == null) && !isDeleted("socialLink", l.id)).length;

  const counts = {
    v1: {
      titles: countIn("heroTitle", titles, "v1"),
      badges: countIn("heroSkillBadge", badges, "v1"),
      socials: socialCount("v1"),
    },
    v2: {
      titles: countIn("heroTitle", titles, "v2"),
      badges: countIn("heroSkillBadge", badges, "v2"),
      socials: socialCount("v2"),
    },
  };

  // Staging makes the flip atomic with the rows it depends on, but nothing stops
  // a hero from having no role line at all — either by flipping to a version
  // nobody has written a title for, or by emptying the titles of the version
  // already live. Deliberately direction-neutral: the second case is the more
  // dangerous one, since it needs no flip to reach visitors.
  const blockedReason =
    counts[version].titles === 0
      ? `Add a ${version} role title — the line under your name would be empty.`
      : undefined;

  const groups: ConfigGroup[] = [
    {
      n: "03",
      title: "Identity",
      blurb: "Who the page says you are, and the picture it says it with.",
      keys: ["name", "avatarUrl", "heroPhotos"],
    },
    {
      n: "04",
      title: "Status dot",
      blurb: "The dot beside the availability line. The line itself is Contact's — the hero only renders it.",
      keys: ["heroDotColor", "heroDotPulse"],
      slot: (
        <Borrowed
          label="availabilityStatus"
          value={availabilityStatus}
          empty="not set — the hero draws no availability line, and this dot with it"
          owner="Contact"
          href="/contact-purposes"
        />
      ),
    },
  ];

  // Same comma-split as apps/web/app/lib/data.ts; `cdnUrl` runs inside the pane.
  const photos = (draft["heroPhotos"] ?? "").split(",").map((p) => p.trim()).filter(Boolean);

  return (
    <div className="hro-page">
      <Block n="01" title="Version" note="Two layouts exist. One ships." />
      <HeroVersionCard
        content={content}
        version={version}
        onPick={setVersion}
        counts={counts}
        blockedReason={blockedReason}
      />

      <Block n="02" title="Headline & copy" note={`Everything scoped to ${version}.`} />
      <div className="hro-stack">
        <HeroCopyCard content={content} version={version} />
        <HeroTitlesTable titles={titles} version={version} />
        <HeroSkillBadgesTable badges={badges} version={version} />
      </div>

      <ConfigCard
        groups={groups}
        values={config}
        onDraftChange={onDraftChange}
        heading={(g) => <Block n={g.n ?? ""} title={g.title} />}
      />

      <Block n="05" title="Social row" note="Drawn again in Contact and the footer." />
      <SocialLinksTable links={socialLinks} />

      <Block n="06" title="Résumé" note="The button beside the social row." />
      <ResumeForm resumeUrl={resumeUrl} />

      <StagedHeroPreview
        version={version}
        titles={titles.map((t) => ({ id: t.id, title: t.title, version: t.version }))}
        badges={badges.map((b) => ({ id: b.id, name: b.name, version: b.version }))}
        socialLinks={socialLinks.map((l) => ({ id: l.id, name: l.name, iconKey: l.iconKey, version: l.version }))}
        content={content}
        name={draft["name"] || "Yatin"}
        avatarUrl={draft["avatarUrl"] || undefined}
        photos={photos}
        availabilityStatus={availabilityStatus}
        dotColor={draft["heroDotColor"] ?? ""}
        dotPulse={(draft["heroDotPulse"] ?? "on") !== "off"}
        totalSkills={totalSkills}
        label={`Hero — ${version}${liveVersion === version ? " · live" : " · draft, not what visitors see"}`}
      />
    </div>
  );
}

/** The page's numbered rhythm: an ordinal, a name, a rule out to the margin. */
function Block({ n, title, note }: { n: string; title: string; note?: string }) {
  return (
    <div className="hro-blk">
      <span className="hro-blk-n">{n}</span>
      <h2 className="hro-blk-t">{title}</h2>
      {note && <span className="hro-blk-m">{note}</span>}
      <i aria-hidden="true" />
    </div>
  );
}
