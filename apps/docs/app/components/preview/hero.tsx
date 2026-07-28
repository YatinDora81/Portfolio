"use client";

import { findSkillIcon, findSocialIcon } from "@repo/ui/icons/registry";
import { cdnUrl } from "@/lib/utils";
import { DIM, FAINT, FADE_MS, MONO, useRotatingTitle } from "./frame";

// ─── Hero Preview ────────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/Hero.tsx at card scale: the
// availability + socials top row, the fanned photo deck, the uppercase
// nameplate, the `// role ▮` line, the body, and the paw-print scroll cue.
//
// Everything above the body is shared, exactly as it is on the site. The body
// is the whole of the version split, so it lives in `BodyV1` / `BodyV2` here
// the same way it lives in `HeroBodyV1` / `HeroBodyV2` there:
//
//   v1 — one paragraph carrying the intro, the chips inline with an " and "
//        before the last, and `. ${tagline}` tacked on; ghost Resume / CV then
//        solid Get in touch; five strokes on the document icon.
//   v2 — a plain intro paragraph, an italic voice line for the tagline, a
//        wrapped pill row ending in the "+N more ↓" doorway to #skills; solid
//        Get in touch then ghost View Resume; four strokes on the icon.
//
// The hero is interactive on the real site — the photo trails the cursor across
// the letters and each social pill unfurls its label on hover. A preview can't
// hover, so this draws the resting state: the static `.peek-stack` deck the
// site itself falls back to on touch / reduced motion, plus the `hover my name`
// hint the pointer-fine layout shows in the role line.

const LINE = "rgba(255,255,255,0.1)";

/** The site's `--foreground` on this pane's dark surface — what an unset
    `heroDotColor` renders as, so "no colour chosen" previews honestly. */
const DOT_DEFAULT = "#fafafa";

/** How `.peek-stack` fans its three cards, scaled down from 86×104 to 52×62. */
const DECK_TILT = ["rotate(-6deg)", "rotate(3deg) translateY(-4px)", "rotate(-2deg)"];
const DECK_Z = [1, 3, 2];

/** `.cue i:nth-child(n)` — the three paws stagger in opacity and tilt. */
const PAW_OPACITY = [0.3, 0.55, 0.85];
const PAW_TILT = [
  "translateX(-4px) rotate(-14deg)",
  "translateX(4px) rotate(12deg)",
  "translateX(-3px) rotate(-8deg)",
];

type HeroVersion = "v1" | "v2";

interface HeroPreviewProps {
  /** Which body to draw — the HeroContent row holding `live`, or the tab being
      edited when the caller is showing one version at a time. */
  version: HeroVersion;
  titles: string[];
  name: string;
  tagline: string;
  intro: string;
  skills: { name: string }[];
  /** `iconKey` is optional but strongly preferred: the real hero resolves the
      glyph with `socialIconMap[link.iconKey]`, so a row whose display name
      differs from its icon slug ("LeetCode 2", "GitHub (work)") only draws the
      right glyph here when the key comes through. */
  socialLinks: { name: string; iconKey?: string }[];
  avatarUrl?: string;
  /** Mirrors Hero's `photos` (siteConfig `heroPhotos`). Falls back to `[avatarUrl]`. */
  photos?: string[];
  /** Mirrors Hero's `availabilityStatus`. Absent = not set — never invented,
      because this pill is verbatim CMS copy and a plausible-looking default
      would read as the line that ships. */
  availabilityStatus?: string;
  /** Mirrors Hero's `dotColor` (siteConfig `heroDotColor`). Empty follows the
      site's `--foreground`, which on this pane's dark surface is `DOT_DEFAULT`. */
  dotColor?: string;
  /** Mirrors Hero's `dotPulse` (siteConfig `heroDotPulse`). */
  dotPulse?: boolean;
  /** Mirrors Hero's `totalSkills` — the Skills section's row count, which drives
      v2's "+N more" chip. Absent means unknown, and the chip is left out
      entirely rather than shown against a number this pane guessed. */
  totalSkills?: number;
}

/** Filled paw print — the same glyph the real scroll cue repeats three times. */
function Paw() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: 11, height: 11, display: "block" }}>
      <ellipse cx="5.6" cy="12.3" rx="1.9" ry="2.5" />
      <ellipse cx="9.7" cy="7.8" rx="2" ry="2.7" />
      <ellipse cx="14.3" cy="7.8" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="12.3" rx="1.9" ry="2.5" />
      <path d="M12 12.4c-3.1 0-5.6 2.1-5.6 4.8 0 2 1.7 3.4 3.9 3.4 1 0 1.2-.4 1.7-.4s.7.4 1.7.4c2.2 0 3.9-1.4 3.9-3.4 0-2.7-2.5-4.8-5.5-4.8Z" />
    </svg>
  );
}

/** `.chip`, scaled. The pill row asks for `mono`, matching `.heropills .chip`. */
function SkillChip({ name, mono }: { name: string; mono?: boolean }) {
  const Icon = findSkillIcon(name)?.Icon;
  return (
    <span
      className="inline-flex items-center gap-[5px] align-middle"
      style={{
        height: 20, padding: "0 7px", borderRadius: 6,
        border: `1px dashed ${LINE}`, background: "#262626", color: "#fafafa",
        fontSize: mono ? 10 : 11, fontWeight: 500,
        fontFamily: mono ? MONO : undefined,
      }}
    >
      {Icon && <span className="inline-flex size-[11px] flex-none"><Icon /></span>}
      {name}
    </span>
  );
}

/** v1 draws a fifth stroke that v2 drops. */
function ResumeIcon({ fifthLine }: { fifthLine: boolean }) {
  return (
    <svg
      className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      {fifthLine && <polyline points="10 9 9 9 8 9" />}
    </svg>
  );
}

const BTN = { borderRadius: 7, padding: "7px 13px", fontSize: 11.5, fontWeight: 500 } as const;

function ResumeButton({ version }: { version: HeroVersion }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ ...BTN, border: `1px solid ${LINE}`, background: "#0a0a0a", color: "#fafafa" }}
    >
      <ResumeIcon fifthLine={version === "v1"} />
      {version === "v1" ? "Resume / CV" : "View Resume"}
    </span>
  );
}

function ContactButton() {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ ...BTN, background: "#fafafa", color: "#0a0a0a" }}>
      Get in touch
      <svg
        className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </span>
  );
}

const PARAGRAPH = { fontSize: 12.5, lineHeight: 2, color: DIM, maxWidth: "42rem" } as const;

function BodyV1({ intro, tagline, skills }: { intro: string; tagline: string; skills: { name: string }[] }) {
  return (
    <>
      <p className="mt-4 break-words" style={PARAGRAPH}>
        {intro || "Your intro text"}{" "}
        {skills.map((skill, i) => (
          <span key={`${skill.name}-${i}`}>
            <SkillChip name={skill.name} />
            {i < skills.length - 2 && " "}
            {i === skills.length - 2 && " and "}
          </span>
        ))}
        {tagline ? `. ${tagline}` : skills.length > 0 ? "." : ""}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <ResumeButton version="v1" />
        <ContactButton />
      </div>
    </>
  );
}

function BodyV2({ intro, tagline, skills, totalSkills }: {
  intro: string;
  tagline: string;
  skills: { name: string }[];
  totalSkills?: number;
}) {
  const remaining = (totalSkills ?? 0) - skills.length;

  return (
    <>
      <p className="mt-4 break-words" style={PARAGRAPH}>{intro || "Your intro text"}</p>
      {/* `.voice` — same ink as the intro, a step smaller and in italics */}
      {tagline && (
        <p className="mt-2 break-words italic" style={{ fontSize: 11.5, color: DIM, maxWidth: "42rem" }}>
          {tagline}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {skills.map((skill, i) => <SkillChip key={`${skill.name}-${i}`} name={skill.name} mono />)}
        {remaining > 0 && (
          <span
            className="inline-flex items-center"
            style={{
              height: 20, padding: "0 7px", borderRadius: 6, border: `1px solid ${LINE}`,
              color: DIM, fontFamily: MONO, fontSize: 10, fontWeight: 500,
            }}
          >
            +{remaining} more ↓
          </span>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <ContactButton />
        <ResumeButton version="v2" />
      </div>
    </>
  );
}

export function HeroPreview({
  version, titles, name, tagline, intro, skills, socialLinks, avatarUrl,
  photos, availabilityStatus, dotColor, dotPulse = true, totalSkills,
}: HeroPreviewProps) {
  // The hook owns the 2500ms hold / 400ms fade AND the guard that stops an
  // interrupted fade stranding the word at opacity 0 — never re-implement it here.
  const { index, visible } = useRotatingTitle(titles.length);
  const current = titles[index] ?? "";

  const displayName = name.trim().split(/\s+/).filter(Boolean).join(" ");
  const status = availabilityStatus?.trim() ?? "";
  const dot = dotColor?.trim() || DOT_DEFAULT;
  // Same deck rule as Hero: explicit photos win, else the avatar, else nothing.
  const deck = (photos && photos.length > 0 ? photos : avatarUrl ? [avatarUrl] : [])
    .filter(Boolean)
    .slice(0, 3);

  return (
    // A query container so the masthead keeps its proportion to the pane rather
    // than to the browser window — the device toggle changes one and not the other.
    <div className="@container">
      {/* top row — availability left, socials + location right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          className="inline-flex items-center gap-2 uppercase"
          style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.2em", color: DIM }}
        >
          <span className="relative flex size-[6px] flex-none" aria-hidden="true">
            {/* `.avail.still i::after` on the site drops the ripple outright,
                so the pane drops the element rather than freezing it. */}
            {dotPulse && (
              <span
                className="absolute inset-0 rounded-full opacity-60 animate-ping motion-reduce:hidden"
                style={{ background: dot }}
              />
            )}
            <span className="relative size-[6px] rounded-full" style={{ background: dot }} />
          </span>
          {/* Same honesty as ContactPreview, which previews this identical
              field: an unset status shows as unset rather than as copy. */}
          {status
            ? <span>{status}</span>
            : <span className="normal-case italic" style={{ color: FAINT }}>Availability not set</span>}
        </span>

        <div className="flex flex-col items-end gap-1.5">
          {/* icon pills — the label only unfurls on hover, so it stays folded here */}
          {socialLinks.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {socialLinks.map((link, i) => {
                // `iconKey` first, exactly as the real `.soc` does with
                // `socialIconMap[link.iconKey]`; the name is only the fallback.
                const Icon = findSocialIcon(link.iconKey || link.name)?.Icon;
                return (
                  <span
                    key={`${link.name}-${i}`}
                    title={link.name}
                    className="inline-flex h-[21px] w-[21px] items-center justify-center rounded-full"
                    style={{
                      border: `1px solid ${LINE}`, color: DIM,
                      fontFamily: MONO, fontSize: 8.5, textTransform: "lowercase",
                    }}
                  >
                    {/* On a miss the site still draws a round pill with the
                        label collapsed to max-width 0 — so a two-letter glyph
                        stands in rather than the name stretching the pill. */}
                    {Icon ? <Icon className="size-[11px]" /> : <span>{link.name.slice(0, 2)}</span>}
                  </span>
                );
              })}
            </div>
          )}
          <span
            className="inline-flex items-center gap-1 uppercase"
            style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.16em", color: DIM }}
          >
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ width: 10, height: 10, flex: "none" }} aria-hidden="true"
            >
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Based in Bengaluru, India
          </span>
        </div>
      </div>

      {/* the peek deck — fanned, exactly as the site draws it without a fine pointer */}
      <div className="relative mt-5" style={{ height: 62 }} aria-hidden="true">
        {deck.length > 0 ? (
          deck.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${src}-${i}`}
              src={cdnUrl(src)}
              alt=""
              width={52}
              height={62}
              className="absolute top-0 object-cover"
              style={{
                left: i * 38, width: 52, height: 62, borderRadius: 9,
                border: `1px solid ${LINE}`, background: "#262626",
                boxShadow: "0 10px 24px -10px rgba(0,0,0,0.35)",
                transform: DECK_TILT[i], zIndex: DECK_Z[i],
              }}
            />
          ))
        ) : (
          <div
            className="absolute top-0 left-0 flex items-center justify-center text-[13px] font-bold"
            style={{
              width: 52, height: 62, borderRadius: 9, border: `1px dashed ${LINE}`,
              background: "#171717", color: DIM, transform: "rotate(-6deg)",
            }}
          >
            {displayName[0] ?? "?"}
          </div>
        )}
      </div>

      {/* the nameplate — one solid masthead */}
      <h2
        style={{
          margin: "1rem 0 0", fontSize: "clamp(1.5rem, 11cqw, 3.2rem)", fontWeight: 900,
          textTransform: "uppercase", lineHeight: 0.98, letterSpacing: "-0.035em",
          color: "#fafafa", overflowWrap: "anywhere",
        }}
      >
        {displayName || "Your Name"}
        <span style={{ color: DIM }}>.</span>
      </h2>

      {/* role line — "//" + the rotating title + terminal caret */}
      <p
        className="mt-3 flex flex-wrap items-center gap-2"
        style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, color: "#fafafa" }}
      >
        <span aria-hidden="true" style={{ color: DIM, userSelect: "none" }}>{"//"}</span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            color: current ? "#fafafa" : DIM,
            opacity: visible ? 1 : 0,
            filter: visible ? "blur(0px)" : "blur(5px)",
            transform: visible ? "translateY(0)" : "translateY(-0.5rem)",
            transition: `opacity ${FADE_MS}ms ease-in-out, filter ${FADE_MS}ms ease-in-out, transform ${FADE_MS}ms ease-in-out`,
          }}
        >
          {current || "your title"}
        </span>
        <span
          aria-hidden="true"
          className="animate-pulse motion-reduce:animate-none"
          style={{
            display: "inline-block", width: "0.52em", height: "1.05em",
            background: "#fafafa", opacity: 0.85, transform: "translateY(0.12em)",
          }}
        />
        <span aria-hidden="true" style={{ fontSize: 8.5, letterSpacing: "0.08em", color: DIM, opacity: 0.8 }}>
          &larr; hover my name
        </span>
      </p>
      {/* the rotation is decorative — screen readers get the full list, once */}
      {titles.length > 0 && <span className="sr-only">{titles.join(", ")}</span>}

      {version === "v1" ? (
        <BodyV1 intro={intro} tagline={tagline} skills={skills} />
      ) : (
        <BodyV2 intro={intro} tagline={tagline} skills={skills} totalSkills={totalSkills} />
      )}

      {/* scroll cue — paw prints leading down to the cat on the wire */}
      <div className="mt-6 flex flex-col items-center gap-[5px]" style={{ color: DIM }} aria-hidden="true">
        {PAW_OPACITY.map((o, i) => (
          <span key={i} style={{ display: "block", lineHeight: 0, opacity: o, transform: PAW_TILT[i] }}>
            <Paw />
          </span>
        ))}
      </div>
    </div>
  );
}
