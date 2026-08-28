"use client";

import { useEffect, useState } from "react";
import { MapPinIcon } from "@repo/ui/icons/brand";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { cdnUrl } from "@/lib/utils";
import { MONO, SectionLabel, parseBullet } from "./frame";

interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  bullets: string[];
  technologies: string[];
  visibleBullets?: number;
  logoUrl?: string | null;
}

const DEFAULT_VISIBLE_BULLETS = 4;

const PREVIEW_ROLES = 3;

const PREVIEW_CHIPS = 8;

const METRIC = /(\d[\d,.]*\s?(?:%|\+|x|k\+?|K\+?|M\+?|hrs?|mins?|minutes?|mos?|yrs?)?)/g;

function MetricizedDetail({ text }: { text: string }) {
  const parts = text.split(METRIC);
  return (
    <>
      {parts.map((part, i) =>
        // capturing group puts matches at odd indices
        i % 2 === 1 ? (
          <em
            key={i}
            className="not-italic font-medium text-[0.94em] tracking-[-0.01em] text-[#fafafa]"
            style={{ fontFamily: MONO }}
          >
            {part}
          </em>
        ) : (
          part
        )
      )}
    </>
  );
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthOrdinal(value: string, now: number | null): number {
  if (/present|current|now/i.test(value)) return now ?? NaN;
  const parts = value.trim().toLowerCase().split(/\s+/);
  const year = Number(parts[1]);
  if (!Number.isFinite(year)) return NaN;
  const token = parts[0] ?? "";
  const month = token.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(token)) : -1;
  return year * 12 + (month === -1 ? 0 : month);
}

function tenure(start: string, end: string, isCurrent: boolean, now: number | null): string {
  const from = monthOrdinal(start, now);
  const to = isCurrent ? (now ?? NaN) : monthOrdinal(end, now);
  const months = to - from + 1;
  if (!(months > 0)) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const out: string[] = [];
  if (years) out.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (rest) out.push(`${rest} mo${rest > 1 ? "s" : ""}`);
  return out.join(" ");
}

function useMonthNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const d = new Date();
    setNow(d.getFullYear() * 12 + d.getMonth());
  }, []);
  return now;
}

function TechBadge({ name }: { name: string }) {
  const icon = findSkillIcon(name);
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full border border-[rgba(255,255,255,0.1)] bg-[#262626] px-2 py-[2px] text-[9px] text-[#fafafa]"
      style={{ boxShadow: "inset 0 1px 2px rgba(255,255,255,0.06), inset 0 1px 4px rgba(255,255,255,0.03)" }}
    >
      {icon && (
        <span className="inline-flex size-[10px] shrink-0 [&>svg]:block [&>svg]:size-full">
          <icon.Icon />
        </span>
      )}
      {name}
    </span>
  );
}

function LogLine({ bullet }: { bullet: string }) {
  const { highlight, detail } = parseBullet(bullet);
  return (
    <li className="grid grid-cols-[16px_1fr] gap-x-2 text-[11px] leading-[1.65]">
      <span
        className="flex h-[1.65em] items-center justify-end text-[9px] leading-none text-[rgba(144,144,146,0.62)]"
        style={{ fontFamily: MONO }}
        aria-hidden
      >
        &#8212;
      </span>
      <span className="line-clamp-2 text-[#909092]">
        <b className="font-medium text-[#fafafa]">{highlight}</b> <MetricizedDetail text={detail} />
      </span>
    </li>
  );
}

function ExperienceCard({ exp, now }: { exp: ExperienceData; now: number | null }) {
  const duration = tenure(exp.startDate, exp.endDate, exp.isCurrent, now);
  const endLabel = exp.isCurrent ? exp.endDate || "Present" : exp.endDate;

  const configured = exp.visibleBullets ?? DEFAULT_VISIBLE_BULLETS;
  const limit = configured > 0 ? configured : DEFAULT_VISIBLE_BULLETS;
  const overflows = exp.bullets.length > limit;
  const head = overflows ? exp.bullets.slice(0, limit) : exp.bullets;
  const hidden = exp.bullets.length - head.length;

  const chips = exp.technologies.slice(0, PREVIEW_CHIPS);
  const moreChips = exp.technologies.length - chips.length;

  return (
    <div className="relative">
      <span
        className={`absolute -left-[22px] top-[5px] size-[9px] rounded-full border-[1.5px] bg-[#0a0a0a] ${
          exp.isCurrent ? "border-[#22c55e]" : "border-[rgba(250,250,250,0.55)]"
        }`}
        aria-hidden
      >
        {exp.isCurrent && (
          <span className="absolute -inset-[1.5px] rounded-full border-[1.5px] border-[#22c55e] animate-ping motion-reduce:animate-none" />
        )}
      </span>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {exp.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cdnUrl(exp.logoUrl)}
                alt=""
                aria-hidden
                className="size-[18px] shrink-0 rounded object-contain"
              />
            )}
            <span className="text-[13px] font-bold leading-tight text-[#fafafa]">{exp.company}</span>
            {exp.isCurrent && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(34,197,94,0.1)] px-1.5 py-[1px] text-[9px] text-[#4ade80]">
                <i className="size-1 rounded-full bg-[#22c55e] animate-pulse motion-reduce:animate-none" />
                Current
              </span>
            )}
          </div>
          <p className="mt-[2px] text-[11px] text-[#909092]">{exp.position}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-[#909092]">
          <span className="inline-flex items-center gap-2 text-[9.5px] tracking-[0.01em]" style={{ fontFamily: MONO }}>
            {exp.startDate} - {endLabel}
            {duration && (
              <span className="whitespace-nowrap rounded-full border border-dashed border-[rgba(255,255,255,0.1)] px-1.5 py-[1px] text-[9px] tracking-[0.04em]">
                {duration}
              </span>
            )}
          </span>
          {exp.location && (
            <span className="inline-flex items-center gap-1 text-[10px]">
              <MapPinIcon className="size-[10px]" />
              {exp.location}
            </span>
          )}
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-[5px]">
          {chips.map((tech) => <TechBadge key={tech} name={tech} />)}
          {moreChips > 0 && (
            <span className="text-[9px] text-[#737373]" style={{ fontFamily: MONO }}>+{moreChips}</span>
          )}
        </div>
      )}

      {head.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-2">
          {head.map((bullet, i) => <LogLine key={i} bullet={bullet} />)}
        </ul>
      )}

      {overflows && (
        <>
          <div
            className="relative pointer-events-none"
            style={{
              height: 22,
              marginTop: -22,
              background: "linear-gradient(to bottom, transparent 0%, rgba(10,10,10,0.82) 62%, #0a0a0a 100%)",
            }}
            aria-hidden
          />
          <div
            className="mt-1.5 flex items-center gap-3 py-1 text-[8.5px] tracking-[0.12em] text-[#909092]"
            style={{ fontFamily: MONO }}
          >
            <span className="h-px flex-1 bg-[rgba(255,255,255,0.1)]" />
            <span className="inline-flex items-center gap-[0.55ch]">
              + {hidden} more
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
            <span className="h-px flex-1 bg-[rgba(255,255,255,0.1)]" />
          </div>
        </>
      )}
    </div>
  );
}

export function ExperiencePreview({ experiences }: { experiences: ExperienceData[] }) {
  const now = useMonthNow();

  const shown = experiences.slice(0, PREVIEW_ROLES);
  const moreRoles = experiences.length - shown.length;

  return (
    <div>
      <SectionLabel sub="Career" main="Experience" />

      {experiences.length === 0 ? (
        <p className="text-[10px] italic text-[#737373]">No experiences yet</p>
      ) : (
        <div className="relative flex flex-col gap-6 pl-6">
          <span className="absolute left-[6px] top-2 bottom-2 w-px bg-[rgba(255,255,255,0.1)]" aria-hidden />
          {shown.map((exp, i) => (
            <ExperienceCard key={`${exp.company}-${exp.startDate}-${i}`} exp={exp} now={now} />
          ))}
        </div>
      )}

      {moreRoles > 0 && (
        <div
          className="mt-5 flex items-center gap-3 text-[8.5px] uppercase tracking-[0.25em] text-[#909092]"
          style={{ fontFamily: MONO }}
        >
          <span className="h-px flex-1 bg-[rgba(255,255,255,0.1)]" />
          + {moreRoles} more {moreRoles === 1 ? "role" : "roles"}
          <span className="h-px flex-1 bg-[rgba(255,255,255,0.1)]" />
        </div>
      )}
    </div>
  );
}
