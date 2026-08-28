"use client";

import type { Entity } from "@/lib/actions/staging";
import { cdnUrl } from "@/lib/utils";
import { useStaging } from "@/components/staging/staging-provider";
import { useLiveVersion, type HeroContentRow } from "@/components/staging/hero-live";
import {
  PreviewFrame,
  AboutPreview,
  ContactPreview,
  HeroPreview,
  LinksPreview,
  QuotesPreview,
  SkillsPreview,
} from "./index";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function useLive<T extends { id: string }>(entity: Entity, rows: T[], version?: string | null): T[] {
  const { overlay, isDeleted } = useStaging();
  return overlay(entity, rows, (r) => r.id, version).filter((r) => !isDeleted(entity, r.id));
}

function usePendingCount(entities: readonly Entity[]): number {
  const { ops } = useStaging();
  return ops.filter((op) => entities.includes(op.entity)).length;
}

const HERO_ENTITIES = ["heroTitle", "heroSkillBadge", "heroContent", "socialLink"] as const;
const ABOUT_ENTITIES = ["aboutParagraph", "education"] as const;
const SKILL_ENTITIES = ["skill"] as const;
const QUOTE_ENTITIES = ["quote"] as const;
const CONTACT_ENTITIES = ["contactPurpose", "socialLink"] as const;
const LINK_ENTITIES = ["socialLink"] as const;

export function StagedHeroPreview({
  version, titles, badges, socialLinks, content, name, avatarUrl, photos,
  availabilityStatus, dotColor, dotPulse, totalSkills, label = "Hero Preview",
}: {
  version?: "v1" | "v2";
  titles: { id: string; title: string; version: string }[];
  badges: { id: string; name: string; version: string }[];
  socialLinks: { id: string; name: string; iconKey?: string; version: string | null }[];
  content: HeroContentRow[];
  name: string;
  avatarUrl?: string;
  photos?: string[];
  availabilityStatus?: string;
  dotColor?: string;
  dotPulse?: boolean;
  totalSkills?: number;
  label?: string;
}) {
  const live = useLiveVersion(content);
  const v = version ?? live;

  // filter after the overlay, never on the server rows
  const t = useLive("heroTitle", titles, v).filter((x) => x.version === v);
  const b = useLive("heroSkillBadge", badges, v).filter((x) => x.version === v);
  const s = useLive("socialLink", socialLinks).filter((x) => x.version === v || x.version == null);
  const c = useLive("heroContent", content).find((x) => x.version === v);
  const pending = usePendingCount(HERO_ENTITIES);

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <HeroPreview
        version={v}
        titles={t.map((x) => str(x.title))}
        name={name}
        tagline={str(c?.tagline)}
        intro={str(c?.intro)}
        skills={b.map((x) => ({ name: str(x.name) }))}
        socialLinks={s.map((x) => ({ name: str(x.name), iconKey: str(x.iconKey) || undefined }))}
        avatarUrl={avatarUrl}
        photos={photos}
        availabilityStatus={availabilityStatus}
        dotColor={dotColor}
        dotPulse={dotPulse}
        totalSkills={totalSkills}
      />
    </PreviewFrame>
  );
}

export function StagedAboutPreview({ paragraphs, education, experiences, label = "About Preview" }: {
  paragraphs: { id: string; content: string }[];
  education: {
    id: string;
    institution: string;
    degree: string;
    location: string;
    scoreType: string | null;
    score: string | null;
    scoreTotal: string | null;
    startYear: string;
    endYear: string;
  }[];
  experiences?: { company: string; logoUrl: string | null }[];
  label?: string;
}) {
  const p = useLive("aboutParagraph", paragraphs);
  const e = useLive("education", education);
  const pending = usePendingCount(ABOUT_ENTITIES);

  const companyLogos = Object.fromEntries(
    (experiences ?? [])
      .filter((x) => x.logoUrl)
      .map((x) => [x.company.trim().toLowerCase(), cdnUrl(x.logoUrl) as string])
  );

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <AboutPreview
        paragraphs={p.map((x) => str(x.content))}
        companyLogos={companyLogos}
        education={e.map((x) => ({
          institution: str(x.institution),
          degree: str(x.degree),
          location: str(x.location),
          scoreType: x.scoreType ?? null,
          score: x.score ?? null,
          scoreTotal: x.scoreTotal ?? null,
          startYear: str(x.startYear),
          endYear: str(x.endYear),
        }))}
      />
    </PreviewFrame>
  );
}

export function StagedSkillsPreview({ skills, label = "Skills Preview" }: {
  skills: { id: string; name: string; show: boolean }[];
  label?: string;
}) {
  const live = useLive("skill", skills);
  const pending = usePendingCount(SKILL_ENTITIES);

  // visibility filter runs after the overlay
  const shown = live.filter((s) => s.show !== false);

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <SkillsPreview skills={shown.map((s) => ({ name: str(s.name) }))} />
    </PreviewFrame>
  );
}

export function StagedQuotesPreview({ quotes, dayOfYear, label = "Quotes Preview" }: {
  quotes: { id: string; quote: string; author: string }[];
  dayOfYear: number;
  label?: string;
}) {
  const live = useLive("quote", quotes);
  const pending = usePendingCount(QUOTE_ENTITIES);

  const index = live.length === 0 ? 0 : dayOfYear % live.length;

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <QuotesPreview
        quotes={live.map((q) => ({ quote: str(q.quote), author: str(q.author) }))}
        todayIndex={index}
        dayOfYear={dayOfYear}
      />
    </PreviewFrame>
  );
}

export function StagedContactPreview({
  purposes, socialLinks, availabilityStatus, availabilityDetail,
  contactEmail, resumeUrl, label = "Contact Preview",
}: {
  purposes: { id: string; label: string; emoji: string }[];
  socialLinks: { id: string; name: string; iconKey?: string; detail?: string | null }[];
  availabilityStatus?: string;
  availabilityDetail?: string;
  contactEmail?: string;
  resumeUrl?: string;
  label?: string;
}) {
  const p = useLive("contactPurpose", purposes);
  const s = useLive("socialLink", socialLinks);
  const pending = usePendingCount(CONTACT_ENTITIES);

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <ContactPreview
        purposes={p.map((x) => ({ label: str(x.label), emoji: str(x.emoji) }))}
        socialLinks={s.map((x) => ({
          name: str(x.name),
          iconKey: str(x.iconKey) || undefined,
          detail: x.detail ?? null,
        }))}
        availabilityStatus={availabilityStatus}
        availabilityDetail={availabilityDetail}
        contactEmail={contactEmail}
        resumeUrl={resumeUrl}
      />
    </PreviewFrame>
  );
}

export function StagedLinksPreview({
  socialLinks, resumeUrl, contactEmail, copyrightName, label = "Links Preview",
}: {
  socialLinks: { id: string; name: string; href: string; iconKey: string; detail: string | null }[];
  resumeUrl?: string;
  contactEmail?: string;
  copyrightName?: string;
  label?: string;
}) {
  const s = useLive("socialLink", socialLinks);
  const pending = usePendingCount(LINK_ENTITIES);

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <LinksPreview
        socialLinks={s.map((l) => ({
          name: str(l.name),
          href: str(l.href),
          iconKey: str(l.iconKey),
          detail: l.detail ?? null,
        }))}
        resumeUrl={resumeUrl}
        contactEmail={contactEmail}
        copyrightName={copyrightName}
      />
    </PreviewFrame>
  );
}
