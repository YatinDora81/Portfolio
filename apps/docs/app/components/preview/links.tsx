"use client";

import { useEffect, useState } from "react";
import { findSocialIcon } from "@repo/ui/icons/registry";
import { DIM, FAINT, MONO } from "./frame";

interface LinksPreviewProps {
  socialLinks: { name: string; href: string; iconKey: string; detail: string | null }[];
  resumeUrl?: string;
  contactEmail?: string;
  copyrightName?: string;
}

function useYearNow(): number | null {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => { setYear(new Date().getFullYear()); }, []);
  return year;
}

function SurfaceLabel({ tint, ink, name, note }: { tint: string; ink: string; name: string; note: string }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <span
        className="rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider"
        style={{ background: tint, color: ink, fontFamily: MONO }}
      >
        {name}
      </span>
      <span className="text-[9px]" style={{ color: FAINT }}>{note}</span>
    </div>
  );
}

function Rule() {
  return <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />;
}

function Wordmark({ text }: { text: string }) {
  const effLen = [...text].reduce((a, ch) => a + (ch === " " ? 0.5 : 1), 0);
  const fs = Math.max(54, Math.min(100, Math.round(665 / Math.max(effLen, 1))));
  const capH = fs * 0.727;
  const y = Math.round(5 + capH);
  const vbH = Math.round(5 + capH * 0.77); // bottom crop, 77% of cap height

  return (
    <svg viewBox={`0 0 400 ${vbH}`} className="mt-3 block w-full" role="presentation" focusable="false">
      <defs>
        <linearGradient id="preview-wordmark-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fafafa" stopOpacity="0.55" />
          <stop offset="0.55" stopColor="#fafafa" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fafafa" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <text
        x={200}
        y={y}
        textAnchor="middle"
        textLength={392}
        lengthAdjust="spacingAndGlyphs"
        fontSize={fs}
        fontWeight={900}
        letterSpacing="-0.02em"
        fill="url(#preview-wordmark-fade)"
      >
        {text}
      </text>
    </svg>
  );
}

export function LinksPreview({ socialLinks, resumeUrl, contactEmail, copyrightName }: LinksPreviewProps) {
  const mark = (copyrightName ?? "").trim().toUpperCase() || "PORTFOLIO";
  const year = useYearNow();

  return (
    <div className="space-y-5">
      <div>
        <SurfaceLabel
          tint="rgba(168,85,247,0.15)"
          ink="#c084fc"
          name="Hero"
          note="icon pills top-right, buttons under the intro"
        />

        {socialLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {socialLinks.map((l, i) => {
              const icon = findSocialIcon(l.iconKey || l.name);
              return (
                <span
                  key={`${l.name}-${i}`}
                  role="img"
                  aria-label={l.name}
                  title={l.name}
                  className="inline-flex h-[22px] items-center justify-center rounded-full border border-[rgba(255,255,255,0.1)] px-2"
                  style={{ color: DIM }}
                >
                  {icon ? (
                    <icon.Icon className="size-3" />
                  ) : (
                    <span className="text-[8px] font-bold" style={{ fontFamily: MONO }}>
                      {l.name.slice(0, 2).toLowerCase()}
                    </span>
                  )}
                </span>
              );
            })}
            <span className="text-[8px]" style={{ fontFamily: MONO, color: FAINT }}>
              &larr; each pill widens to its label on hover
            </span>
          </div>
        ) : (
          <p className="text-[10px] italic text-[#737373]">No social links yet — the hero rail is empty</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium"
            style={{ background: "#fafafa", color: "#0a0a0a" }}
          >
            Get in touch
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium"
            style={{ border: "1px solid rgba(255,255,255,0.1)", background: "#0a0a0a", color: "#fafafa" }}
          >
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            View Resume
          </span>
        </div>

        <p
          className="mt-2 truncate text-[8px]"
          style={{ fontFamily: MONO, color: resumeUrl ? "#737373" : "#f59e0b" }}
        >
          {resumeUrl ? `resume → ${resumeUrl}` : "no resume URL set — the button opens nothing"}
        </p>
      </div>

      <Rule />

      <div>
        <SurfaceLabel
          tint="rgba(244,63,94,0.15)"
          ink="#fb7185"
          name="Contact"
          note="sidebar rows beside the message form"
        />

        <div className="space-y-0.5">
          {socialLinks.map((l, i) => {
            const icon = findSocialIcon(l.iconKey || l.name);
            const detail = l.detail || (icon?.key === "email" ? contactEmail : "");
            return (
              <div key={`${l.name}-${i}`} className="flex items-center gap-2 px-1.5 py-1.5">
                <span className="flex size-4 flex-none items-center justify-center" style={{ color: DIM }}>
                  {icon ? (
                    <icon.Icon className="size-4" />
                  ) : (
                    <span className="flex size-4 items-center justify-center rounded bg-[#262626] text-[7px] font-bold">
                      {l.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[10px] font-medium text-[#fafafa]">{l.name}</span>
                  {detail && <span className="truncate text-[8px]" style={{ color: DIM }}>{detail}</span>}
                  <span className="truncate text-[8px]" style={{ fontFamily: MONO, color: FAINT }}>
                    {l.href}
                  </span>
                </div>
              </div>
            );
          })}
          {socialLinks.length === 0 && <p className="text-[10px] italic" style={{ color: FAINT }}>No social links yet</p>}
        </div>

        {contactEmail && (
          <p className="mt-2 truncate text-[8px] text-[#737373]" style={{ fontFamily: MONO }}>
            form fallback &rarr; mailto:{contactEmail}
          </p>
        )}
      </div>

      <Rule />

      <div>
        <SurfaceLabel
          tint="rgba(59,130,246,0.15)"
          ink="#60a5fa"
          name="Footer"
          note="no links down here — the wordmark and copyright only"
        />

        <div className="overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] px-3 pt-3">
          <div aria-hidden className="flex items-center gap-2 text-[8px]" style={{ color: DIM }}>
            <span className="h-px flex-1 bg-[rgba(255,255,255,0.1)]" />
            <span>&#10022;</span>
            <span className="h-px flex-1 bg-[rgba(255,255,255,0.1)]" />
          </div>

          <p
            className="mt-3 text-center text-[7px] uppercase tracking-[0.2em]"
            style={{ fontFamily: MONO, color: DIM }}
          >
            &copy; {year ? `${year} ` : ""}{mark} &mdash; all rights reserved
          </p>

          <Wordmark text={mark} />
        </div>

        {!copyrightName && (
          <p className="mt-1.5 text-[8px] text-[#737373]" style={{ fontFamily: MONO }}>
            wordmark reads your copyright name &mdash; placeholder shown here
          </p>
        )}
      </div>
    </div>
  );
}
