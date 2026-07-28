"use client";

import { findSocialIcon } from "@repo/ui/icons/registry";
import { DIM, FAINT, SectionLabel } from "./frame";

// ─── Contact Preview ─────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/Contact.tsx: a 3/2 split of form and
// sidebar, purpose pills above the fields, the send button pushed to the right,
// and the availability pulse sitting on top of the social rows.
//
// Drawn in the form's RESTING state — nothing typed, no purpose selected — which
// is what a visitor sees when the section scrolls in.

interface ContactPreviewProps {
  purposes: { label: string; emoji: string }[];
  availabilityStatus?: string;
  availabilityDetail?: string;
  /** `iconKey`/`detail` are optional: callers that only have names still work,
      and the glyph then falls back to matching the name against the registry. */
  socialLinks?: { name: string; iconKey?: string; detail?: string | null }[];
}

/** Placeholder text on the site is `muted-foreground/50` over the card — the
 *  one string in this section that really is `--muted-foreground` (#a3a3a3)
 *  rather than `.text-secondary`, so it does NOT use `DIM`. */
const PLACEHOLDER = "rgba(163,163,163,0.5)";

function Field({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] px-2 py-1.5 text-[9px] ${className ?? ""}`}
      style={{ color: PLACEHOLDER }}
    >
      {children}
    </div>
  );
}

export function ContactPreview({ purposes, availabilityStatus, availabilityDetail, socialLinks }: ContactPreviewProps) {
  return (
    <div className="@container">
      <SectionLabel sub="Let's Connect" main="Get in Touch" />

      {/* stacked below the site's `md` breakpoint, 3/2 above it */}
      <div className="grid grid-cols-5 gap-4 @max-[440px]:grid-cols-1 @max-[440px]:gap-5">
        {/* ── the form ── */}
        <div className="col-span-3 min-w-0 space-y-2.5 @max-[440px]:col-span-1">
          <div>
            {/* Contact.tsx:80 — `.text-secondary`, and uppercase there too */}
            <span className="mb-1.5 block text-[8px] font-medium uppercase tracking-wider" style={{ color: DIM }}>
              What&apos;s this about?
            </span>
            <div className="flex flex-wrap gap-1.5">
              {purposes.map((p) => (
                // Resting = unselected: card fill, hairline border, secondary
                // text. The filled treatment only lands once one is clicked.
                <span
                  key={p.label}
                  className="rounded-full border border-[rgba(255,255,255,0.1)] bg-[#171717] px-2 py-0.5 text-[8px] font-medium"
                  style={{ color: DIM }}
                >
                  <span className="mr-0.5">{p.emoji}</span>
                  {p.label}
                </span>
              ))}
              {purposes.length === 0 && (
                <span className="text-[8px] italic" style={{ color: FAINT }}>No purposes yet — the pill row is empty</span>
              )}
            </div>
          </div>

          {/* name/email sit side by side above the site's `sm` breakpoint only */}
          <div className="grid grid-cols-2 gap-2 @max-[440px]:grid-cols-1">
            <Field>Your name</Field>
            <Field>you@example.com</Field>
          </div>
          <Field className="min-h-[38px]">Tell me about your project or idea...</Field>

          <span className="ml-auto flex w-fit items-center gap-1 rounded-lg bg-[#fafafa] px-3 py-1.5 text-[9px] font-medium text-[#0a0a0a]">
            <svg className="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            Send Message
          </span>
        </div>

        {/* ── the sidebar ── */}
        <div className="col-span-2 min-w-0 space-y-0.5 @max-[440px]:col-span-1">
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <span className="relative flex size-3 flex-none items-center justify-center">
              {/* the site's availability ping — held still under reduced motion */}
              <span className="absolute inline-flex size-1.5 motion-safe:animate-ping rounded-full bg-[#4ade80] opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[#22c55e]" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[10px] font-medium text-[#fafafa]">
                {availabilityStatus || <span className="italic" style={{ color: FAINT }}>Availability not set</span>}
              </span>
              {availabilityDetail && (
                // Contact.tsx:180 — `.text-secondary`
                <span className="truncate text-[8px]" style={{ color: DIM }}>{availabilityDetail}</span>
              )}
            </div>
          </div>

          {/* Keyed on the index too — `name` is user-editable and not unique, and
              a half-filled staged create arrives as "" from `str()`. */}
          {socialLinks?.map((l, i) => {
            // Name-based lookup covers the common case where the caller only
            // passes names — "GitHub" resolves to the `github` entry.
            const icon = findSocialIcon(l.iconKey || l.name);
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
                  {l.detail && <span className="truncate text-[8px]" style={{ color: DIM }}>{l.detail}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
