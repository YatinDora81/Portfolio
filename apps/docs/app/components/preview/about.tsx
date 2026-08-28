"use client";

import { GraduationCapIcon, MapPinIcon } from "@repo/ui/icons/brand";
import { DIM, FAINT, MONO, SectionLabel, renderBold } from "./frame";

const BORDER = "rgba(255,255,255,0.1)";

const UNLOCK_HINT = "# type 'help' to explore — try \"skills\" ⏎";

interface EducationEntry {
  institution: string;
  degree: string;
  location?: string;
  scoreType?: string | null;
  score?: string | null;
  scoreTotal?: string | null;
  startYear: string;
  endYear: string;
}

interface AboutPreviewProps {
  paragraphs: string[];
  education: EducationEntry[];
  companyLogos?: Record<string, string>;
}

function Prompt() {
  return (
    <span className="whitespace-pre">
      <span style={{ color: "#10b981" }}>➜</span>
      {"  "}
      <span style={{ color: DIM }}>~</span>
      {" "}
    </span>
  );
}

function ScoreRing({ score, scoreTotal, scoreType }: {
  score: string;
  scoreTotal?: string | null;
  scoreType?: string | null;
}) {
  const value = parseFloat(score);
  const total = scoreType === "CGPA" ? parseFloat(scoreTotal ?? "10") || 10 : 100;
  // a non-numeric score would render as a full ring
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(1, value / total)) : 0;
  const circumference = 2 * Math.PI * 16.5;

  return (
    <div
      className="relative size-11 shrink-0"
      title={`${scoreType ?? "Score"}: ${score}${scoreType === "CGPA" ? `/${total}` : "%"}`}
    >
      <svg viewBox="0 0 40 40" className="size-11 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r="16.5" fill="none" strokeWidth="2.5" stroke={BORDER} />
        <circle
          cx="20"
          cy="20"
          r="16.5"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke="#fafafa"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[10px] font-bold" style={{ color: "#fafafa" }}>{score}</span>
        <span className="mt-0.5 text-[7px]" style={{ color: DIM }}>
          {scoreType === "CGPA" ? `/ ${total}` : "%"}
        </span>
      </div>
    </div>
  );
}

export function AboutPreview({ paragraphs, education, companyLogos }: AboutPreviewProps) {
  return (
    <div>
      <SectionLabel sub="About" main="Who I am" />

      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: BORDER, background: "#171717" }}
      >
        <div
          className="relative flex items-center gap-1 border-b px-2.5 py-2"
          style={{ borderColor: BORDER, background: "rgba(38,38,38,0.5)" }}
        >
          <span className="size-2 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="size-2 rounded-full" style={{ background: "#febc2e" }} />
          <span className="size-2 rounded-full" style={{ background: "#28c840" }} />
          <span
            className="pointer-events-none absolute inset-x-0 truncate px-2 text-center text-[9px]"
            style={{ fontFamily: MONO, color: DIM }}
          >
            yatin@portfolio — zsh
          </span>
        </div>

        <div
          className="max-h-[240px] overflow-y-auto p-3 text-[11px] leading-relaxed"
          style={{ fontFamily: MONO }}
        >
          <div style={{ color: "#fafafa" }}>
            <Prompt />
            whoami
          </div>

          <div className="mt-2 space-y-2" style={{ color: DIM }}>
            {paragraphs.map((p, i) => (
              <p key={i} className="m-0 break-words">{renderBold(p, companyLogos)}</p>
            ))}
            {paragraphs.length === 0 && (
              <p className="m-0 italic" style={{ color: FAINT }}>
                {"# whoami printed nothing — add an About paragraph"}
              </p>
            )}
          </div>

          <div
            className="mt-2 whitespace-pre-wrap break-words italic"
            style={{ color: "rgba(144,144,146,0.7)" }}
          >
            {UNLOCK_HINT}
          </div>

          <div className="mt-1 flex items-center">
            <span className="shrink-0 whitespace-pre"><Prompt /></span>
            <span
              aria-hidden="true"
              className="inline-block h-3 w-[1ch]"
              style={{ border: "1px solid rgba(250,250,250,0.4)" }}
            />
          </div>
        </div>
      </div>

      {education.length > 0 && (
        <div className="mt-5">
          <p className="text-[9px] uppercase tracking-[0.2em]" style={{ color: DIM }}>Education</p>

          <div className="relative mt-3 space-y-2.5 pl-6">
            <div
              aria-hidden="true"
              className="absolute bottom-2 left-[9px] top-2 w-px border-l border-dashed"
              style={{ borderColor: BORDER }}
            />

            {education.map((edu, i) => (
              <div key={i} className="relative">
                <div
                  aria-hidden="true"
                  className="absolute -left-6 top-3 flex size-5 items-center justify-center rounded-full border"
                  style={{ borderColor: BORDER, background: "#0a0a0a", color: DIM }}
                >
                  <span className="size-1 rounded-full bg-current" />
                </div>

                <div
                  className="flex items-start justify-between gap-2.5 rounded-lg border p-2.5"
                  style={{ borderColor: BORDER, background: "rgba(38,38,38,0.5)" }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className="min-w-0 break-words text-xs font-semibold" style={{ color: "#fafafa" }}>
                        {edu.institution}
                      </h4>
                      <span
                        className="inline-flex h-5 items-center rounded-md border border-dashed px-1.5 text-[9px] font-medium"
                        style={{ borderColor: BORDER, background: "#0a0a0a", color: DIM }}
                      >
                        {edu.startYear} — {edu.endYear}
                      </span>
                    </div>

                    <p className="mt-1 flex items-start gap-1.5 text-[10px]" style={{ color: DIM }}>
                      <GraduationCapIcon className="mt-px size-3 shrink-0" />
                      <span className="min-w-0 break-words">{edu.degree}</span>
                    </p>

                    {edu.location && (
                      <p className="mt-0.5 flex items-start gap-1.5 text-[10px]" style={{ color: DIM }}>
                        <MapPinIcon className="mt-px size-3 shrink-0" />
                        <span className="min-w-0 break-words">{edu.location}</span>
                      </p>
                    )}
                  </div>

                  {edu.score && (
                    <ScoreRing
                      score={edu.score}
                      scoreTotal={edu.scoreTotal}
                      scoreType={edu.scoreType}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
