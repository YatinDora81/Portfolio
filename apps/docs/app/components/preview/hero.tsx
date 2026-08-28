"use client";

import { findSkillIcon, findSocialIcon } from "@repo/ui/icons/registry";
import { cdnUrl } from "@/lib/utils";
import { DIM, FAINT, FADE_MS, MONO, useRotatingTitle } from "./frame";

const LINE = "rgba(255,255,255,0.1)";

const DOT_DEFAULT = "#fafafa";

const DECK_TILT = ["rotate(-6deg)", "rotate(3deg) translateY(-4px)", "rotate(-2deg)"];
const DECK_Z = [1, 3, 2];

const PAW_OPACITY = [0.3, 0.55, 0.85];
const PAW_TILT = [
  "translateX(-4px) rotate(-14deg)",
  "translateX(4px) rotate(12deg)",
  "translateX(-3px) rotate(-8deg)",
];

type HeroVersion = "v1" | "v2";

interface HeroPreviewProps {
  version: HeroVersion;
  titles: string[];
  name: string;
  tagline: string;
  intro: string;
  skills: { name: string }[];
  socialLinks: { name: string; iconKey?: string }[];
  avatarUrl?: string;
  photos?: string[];
  availabilityStatus?: string;
  dotColor?: string;
  dotPulse?: boolean;
  totalSkills?: number;
}

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
  const { index, visible } = useRotatingTitle(titles.length);
  const current = titles[index] ?? "";

  const displayName = name.trim().split(/\s+/).filter(Boolean).join(" ");
  const status = availabilityStatus?.trim() ?? "";
  const dot = dotColor?.trim() || DOT_DEFAULT;
  const deck = (photos && photos.length > 0 ? photos : avatarUrl ? [avatarUrl] : [])
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div className="@container">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          className="inline-flex items-center gap-2 uppercase"
          style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.2em", color: DIM }}
        >
          <span className="relative flex size-[6px] flex-none" aria-hidden="true">
            {dotPulse && (
              <span
                className="absolute inset-0 rounded-full opacity-60 animate-ping motion-reduce:hidden"
                style={{ background: dot }}
              />
            )}
            <span className="relative size-[6px] rounded-full" style={{ background: dot }} />
          </span>
          {status
            ? <span>{status}</span>
            : <span className="normal-case italic" style={{ color: FAINT }}>Availability not set</span>}
        </span>

        <div className="flex flex-col items-end gap-1.5">
          {socialLinks.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {socialLinks.map((link, i) => {
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
      {titles.length > 0 && <span className="sr-only">{titles.join(", ")}</span>}

      {version === "v1" ? (
        <BodyV1 intro={intro} tagline={tagline} skills={skills} />
      ) : (
        <BodyV2 intro={intro} tagline={tagline} skills={skills} totalSkills={totalSkills} />
      )}

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
