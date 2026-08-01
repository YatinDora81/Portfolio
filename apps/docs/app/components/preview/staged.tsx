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

/**
 * Previews that show what the user has STAGED, not what the database holds.
 *
 * Every editable section now stages its edits in the browser and writes only
 * when the save bar commits, so the props a server page renders are one whole
 * batch behind the table sitting directly above the preview. Staging a delete
 * struck the row out and moved the bar to "1 unsaved change" while the preview
 * underneath carried on listing it — misleading at exactly the moment it matters
 * most, the beat before you publish. These wrappers close that gap: they take
 * the server rows *with their ids*, run them through `overlay()`, and hand the
 * result to the untouched preview from `./index`.
 *
 * Two things `overlay()` deliberately does not do, and both matter here:
 *
 * 1. **It leaves staged deletes in the list.** A table needs the struck-through
 *    row to hang its undo off. A preview is simulating the published site, where
 *    that row is simply gone, so every wrapper filters them out.
 * 2. **It materialises a staged create out of the dialog's field bag**, which is
 *    an untyped column bag and can be missing keys outright. `SkillsPreview` and
 *    `LinksPreview` call `.slice()` on the name and `AboutPreview` splits the
 *    paragraph, so a half-filled create would throw rather than render — hence
 *    `str()` on everything that leaves a wrapper.
 *
 * Each wrapper owns its own `PreviewFrame` instead of being dropped inside one:
 * the pages stay server components, and the pending-change count exists only in
 * the browser, so this is the one place that can give the frame its
 * `pendingCount`. Pages render the wrapper alone — no outer `<PreviewFrame>`.
 */

/**
 * A staged create's bag is untyped, so a field the dialog never set arrives as
 * `undefined` however the prop is declared. The previews assume strings.
 */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Server rows with staged creates, edits and the pending drag order folded in —
 * and staged deletes actually dropped, which is the one place a preview must
 * diverge from what the tables render.
 */
function useLive<T extends { id: string }>(entity: Entity, rows: T[], version?: string | null): T[] {
  const { overlay, isDeleted } = useStaging();
  return overlay(entity, rows, (r) => r.id, version).filter((r) => !isDeleted(entity, r.id));
}

/**
 * How many staged ops this preview is actually showing. Scoped to the entities
 * it draws rather than reusing the save bar's total, so a staged quote never
 * makes the hero claim it is displaying a change it knows nothing about.
 */
function usePendingCount(entities: readonly Entity[]): number {
  const { ops } = useStaging();
  return ops.filter((op) => entities.includes(op.entity)).length;
}

/** What each preview draws — the scope of its pending count. */
const HERO_ENTITIES = ["heroTitle", "heroSkillBadge", "heroContent", "socialLink"] as const;
const ABOUT_ENTITIES = ["aboutParagraph", "education"] as const;
const SKILL_ENTITIES = ["skill"] as const;
const QUOTE_ENTITIES = ["quote"] as const;
const CONTACT_ENTITIES = ["contactPurpose", "socialLink"] as const;
const LINK_ENTITIES = ["socialLink"] as const;

// ─── Hero ────────────────────────────────────────────────────────
// Used by the hero page and social-links — both edit one
// of the three entities the hero draws, so all three get the same wrapper.

export function StagedHeroPreview({
  version, titles, badges, socialLinks, content, name, avatarUrl, photos,
  availabilityStatus, dotColor, dotPulse, totalSkills, label = "Hero Preview",
}: {
  /** Which hero this pane is showing, and the scope of every list below. Pass
      it when the caller owns a version tab (/hero). OMIT it when the caller has
      no tab (/social-links): the pane then follows the staged flip, so it can
      never draw one version while its own pending-change chip counts the flip
      to the other. */
  version?: "v1" | "v2";
  titles: { id: string; title: string; version: string }[];
  badges: { id: string; name: string; version: string }[];
  /** `iconKey` is optional so a caller that only has names still compiles, but
      pass it where you have it — the hero's glyph is keyed on it, not on the
      display name. `version` is nullable on this table alone, where NULL means
      the row shows in every hero. */
  socialLinks: { id: string; name: string; iconKey?: string; version: string | null }[];
  /** Both HeroContent rows. The pane picks its own version's copy and overlays
      any staged edit, so typing in the copy card moves the preview immediately —
      the same guarantee the titles and badges already had. */
  content: HeroContentRow[];
  name: string;
  avatarUrl?: string;
  /** siteConfig `heroPhotos`, already split — the site fans these; without them
      the deck falls back to the single avatar card. */
  photos?: string[];
  /** siteConfig `availabilityStatus` — the hero pill is verbatim CMS copy, so
      leaving it out renders "not set" rather than a stand-in sentence. */
  availabilityStatus?: string;
  /** siteConfig `heroDotColor` / `heroDotPulse` — the pill's dot. Both are edited
      on /site-config; they ride along here so a pane on any other page draws the
      dot the site is actually serving instead of the monochrome default. */
  dotColor?: string;
  dotPulse?: boolean;
  /** The Skills section's row count, for v2's "+N more" chip. Omitted = no chip. */
  totalSkills?: number;
  label?: string;
}) {
  // Two separate reasons the version appears twice here. It goes INTO `useLive`
  // because the hero tables scope their reorder ops by version, and a lookup
  // that ignores it renders the other tab's pending drag. It filters AFTER,
  // never on the server rows, because a staged create carries its version in
  // the field bag — filtering first would hide it until save.
  // Resolved before any list is scoped, and unconditionally so the hook order
  // never depends on whether the caller passed a version.
  const live = useLiveVersion(content);
  const v = version ?? live;

  const t = useLive("heroTitle", titles, v).filter((x) => x.version === v);
  const b = useLive("heroSkillBadge", badges, v).filter((x) => x.version === v);
  // Social links are one unscoped list with one drag, so this one stays global.
  const s = useLive("socialLink", socialLinks).filter((x) => x.version === v || x.version == null);
  // No version argument: HeroContent has no reorder op, so there is no
  // per-tab pending drag for the lookup to pick the wrong one of.
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
        // `iconKey` rides along: the site draws `socialIconMap[link.iconKey]`,
        // so a row whose display name differs from its slug ("LeetCode 2") only
        // gets its real glyph here when the key is forwarded. Dropping it — and
        // `availabilityStatus`, which this wrapper already accepted — made the
        // pane show two-letter stand-ins and "Availability not set" for fields
        // the caller had in hand.
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

// ─── About ───────────────────────────────────────────────────────

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
  /** Company marks for the paragraphs, keyed the way apps/web keys them. Plain
      server rows and no `useLive`: Experience is not a staged `Entity`, so
      there is no pending edit for an overlay to fold in. */
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

// ─── Skills ──────────────────────────────────────────────────────

export function StagedSkillsPreview({ skills, label = "Skills Preview" }: {
  /** ALL skills, hidden ones included — the wrapper does the visibility filter,
      or a staged `{ show: true }` would have nothing to bring back. */
  skills: { id: string; name: string; show: boolean }[];
  label?: string;
}) {
  const live = useLive("skill", skills);
  const pending = usePendingCount(SKILL_ENTITIES);

  // The grid is the visible skills only, so the toggle has to be applied AFTER
  // the overlay: staging `{ show: false }` drops the chip, `{ show: true }` puts
  // it back. `!== false` rather than truthiness — a staged create that never set
  // `show` will land on the column default, which `createRow` makes `true`.
  const shown = live.filter((s) => s.show !== false);

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <SkillsPreview skills={shown.map((s) => ({ name: str(s.name) }))} />
    </PreviewFrame>
  );
}

// ─── Quotes ──────────────────────────────────────────────────────

export function StagedQuotesPreview({ quotes, dayOfYear, label = "Quotes Preview" }: {
  quotes: { id: string; quote: string; author: string }[];
  /**
   * The raw UTC day-of-year, NOT a pre-divided index. The modulo has to run
   * against the list that will exist after saving: a server-computed
   * `dayOfYear % serverCount` clamped into the shorter staged list picks a
   * different quote than `QuotesTable` badges and a different one again than
   * the site publishes — three widgets, three "today's quote".
   */
  dayOfYear: number;
  label?: string;
}) {
  const live = useLive("quote", quotes);
  const pending = usePendingCount(QUOTE_ENTITIES);

  // Exactly `thoughtOfDay` from apps/web/app/page.tsx, run over the staged list,
  // so the preview names the quote the site will show the moment this saves.
  const index = live.length === 0 ? 0 : dayOfYear % live.length;

  return (
    <PreviewFrame label={label} pendingCount={pending}>
      <QuotesPreview
        quotes={live.map((q) => ({ quote: str(q.quote), author: str(q.author) }))}
        todayIndex={index}
        // The same raw day again, this time as the numerator the site prints in
        // its keyline. It rides along rather than being recomputed in the pane
        // for the reason above: one formula, three widgets.
        dayOfYear={dayOfYear}
      />
    </PreviewFrame>
  );
}

// ─── Contact ─────────────────────────────────────────────────────

export function StagedContactPreview({
  purposes, socialLinks, availabilityStatus, availabilityDetail,
  contactEmail, resumeUrl, label = "Contact Preview",
}: {
  purposes: { id: string; label: string; emoji: string }[];
  /** `iconKey`/`detail` are optional, but pass them: Contact.tsx sorts the
      GitHub row out by `iconKey`, and every return row's handle is `detail`. */
  socialLinks: { id: string; name: string; iconKey?: string; detail?: string | null }[];
  /** siteConfig `availabilityStatus` / `availabilityDetail` — the caption under
      the oscilloscope and the note in the transmit row. Each falls back to the
      section's own line rather than leaving the instrument unlabelled. */
  availabilityStatus?: string;
  availabilityDetail?: string;
  /** siteConfig `contactEmail` / `resumeUrl` — the address is the carrier line
      and the résumé is the `tape` row on the dial, so without either the site
      drops that block outright and so does the pane. */
  contactEmail?: string;
  resumeUrl?: string;
  /** The frame's caption — not to be confused with a purpose's own `label`. */
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

// ─── Links ───────────────────────────────────────────────────────

export function StagedLinksPreview({
  socialLinks, resumeUrl, contactEmail, copyrightName, label = "Links Preview",
}: {
  socialLinks: { id: string; name: string; href: string; iconKey: string; detail: string | null }[];
  resumeUrl?: string;
  contactEmail?: string;
  /** siteConfig `copyrightName` — feeds the footer wordmark and copyright line.
      Without it the pane drew the `PORTFOLIO` placeholder over a real name. */
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
