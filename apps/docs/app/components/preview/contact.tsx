"use client";

import { useEffect, useState } from "react";
import { FAINT, MONO } from "./frame";

// ─── Contact Preview ─────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/Contact.tsx — "the open channel". The
// aerogramme is gone: no hatch bands, no creases, no stamp, no return rows. Top
// to bottom, in DOM order —
//
//   lab       contact — ch.01
//   ct-head   Open a channel. · the IST clock, ping dot and the cat
//   scope     the oscilloscope band — HUD, trace, caption
//   sentence  the form, which is one sentence with blanks in it
//   carrier   the address riding its wave
//   freqs     the FM dial — GitHub, socials, and the tape
//   ct-close  end of transmission
//
// Drawn in the RESTING state: nothing typed, nothing focused, nothing hovered,
// nothing copied. That has three consequences worth naming, because each one is
// a piece of the real section this pane deliberately does not draw — the HUD's
// "▲ transmitting" is at opacity 0 until a transmit, the `.ack` receipt is an
// empty line until one lands, and the GitHub fold is 0fr tall until hovered.
//
// The wave is the site's own idle carrier, sampled once. `Scope.sampleY` at
// STATIC_T with zero energy — the same single frame the live canvas paints for a
// visitor who asked for reduced motion — flattened into an SVG path, because the
// pane draws and never animates.
//
// The one thing the admin cannot know is the GitHub ledger (contributions,
// streak, capture date, and the year-in-one-line itself), which the site reads
// from its own archive in Postgres. It is labelled rather than invented.

interface ContactPreviewProps {
  purposes: { label: string; emoji: string }[];
  availabilityStatus?: string;
  availabilityDetail?: string;
  /** `iconKey`/`detail` are optional: callers that only have names still work.
      `detail` is the handle each dial row prints on its right, exactly as on the
      site — and where the GitHub row falls back to with no archived activity. */
  socialLinks?: { name: string; iconKey?: string; detail?: string | null }[];
  /** siteConfig `contactEmail` — without it `Carrier` returns null, so the whole
      address block, its wave and the mailto go with it. */
  contactEmail?: string;
  /** siteConfig `resumeUrl` — the site drops the tape row when it is unset. */
  resumeUrl?: string;
}

/** `--ok` on the site's dark theme: the signal dot, and the only green in the
 *  section. */
const OK = "#4ade80";

/** `--lab-dim` / `--lab-2` on dark — the keyline voice and its hints. */
const LAB_DIM = "#8b8b8d";
const LAB_2 = "#a5a5a7";

/** `--muted-foreground` on dark. The sentence is set in it, so the words the
 *  visitor supplies are the only foreground ink in the paragraph. */
const MUTED = "#a3a3a3";

const BORDER = "rgba(255,255,255,0.1)";

/** `color-mix(--muted-foreground 55%, transparent)` over #0a0a0a — the placeholder
 *  ink, resolved once rather than composited here, since the pane's background is
 *  fixed and `color-mix` on a transparent stop would blend against the wrong
 *  thing inside an inline style. */
const PLACEHOLDER = "#5f5f5f";

/** `color-mix(--foreground 30%, transparent)`: the 2px rule under every blank. */
const BLANK_RULE = "rgba(250,250,250,0.3)";

/** `Scope.sampleY`, idle branch, energy 0, t = STATIC_T — sampled at 67 points
 *  and scaled 64/118 so the trace keeps the same share of the band it has on the
 *  site's 118px canvas. */
const TRACE =
  "M0.0,32.58L10.0,32.79L20.0,32.76L30.0,32.43L40.0,31.89L50.0,31.30L60.0,30.81L70.0,30.55L80.0,30.51L90.0,30.63L100.0,30.80L110.0,30.94L120.0,31.03L130.0,31.15L140.0,31.39L150.0,31.82L160.0,32.41L170.0,33.06L180.0,33.60L190.0,33.87L200.0,33.80L210.0,33.44L220.0,32.91L230.0,32.41L240.0,32.07L250.0,31.95L260.0,32.01L270.0,32.12L280.0,32.17L290.0,32.08L300.0,31.86L310.0,31.59L320.0,31.38L330.0,31.28L340.0,31.30L350.0,31.36L360.0,31.36L370.0,31.25L380.0,31.04L390.0,30.81L400.0,30.71L410.0,30.85L420.0,31.27L430.0,31.92L440.0,32.64L450.0,33.27L460.0,33.67L470.0,33.78L480.0,33.66L490.0,33.40L500.0,33.10L510.0,32.85L520.0,32.63L530.0,32.41L540.0,32.13L550.0,31.77L560.0,31.39L570.0,31.07L580.0,30.90L590.0,30.92L600.0,31.13L610.0,31.42L620.0,31.67L630.0,31.78L640.0,31.70L650.0,31.48L660.0,31.24";

/** `Carrier`'s underline wave at rest — its own noise, its own amplitude, drawn
 *  at the site's pixel scale because on the site too the wave only occupies the
 *  middle of its band. */
const CARRIER_WAVE =
  "M0.0,7.93L10.0,8.00L20.0,8.25L30.0,8.56L40.0,8.81L50.0,8.87L60.0,8.68L70.0,8.25L80.0,7.70L90.0,7.14L100.0,6.72L110.0,6.52L120.0,6.53L130.0,6.72L140.0,6.97L150.0,7.20L160.0,7.33L170.0,7.38L180.0,7.40L190.0,7.47L200.0,7.67L210.0,8.03L220.0,8.49L230.0,8.97L240.0,9.35L250.0,9.51L260.0,9.43L270.0,9.13L280.0,8.70L290.0,8.28L300.0,8.00L310.0,7.93L320.0,8.06L330.0,8.31L340.0,8.57L350.0,8.73L360.0,8.70L370.0,8.47L380.0,8.09L390.0,7.65L400.0,7.27L410.0,7.01L420.0,6.90L430.0,6.91L440.0,6.98L450.0,7.04L460.0,7.06L470.0,7.04L480.0,7.02L490.0,7.08L500.0,7.27L510.0,7.61L520.0,8.07L530.0,8.58L540.0,9.04L550.0,9.35L560.0,9.46L570.0,9.37L580.0,9.11L590.0,8.78L600.0,8.47L610.0,8.26L620.0,8.17L630.0,8.19L640.0,8.27L650.0,8.36L660.0,8.39";

/** `BANDS` in Frequencies.tsx, verbatim — a band is an ordinal dressed as a dial
 *  reading, so the pane has to assign them by the same positions or it names the
 *  wrong station. */
const BANDS = ["88.1", "94.3", "101.5", "107.9", "89.7", "96.5", "104.3", "92.7", "99.1"];

/* ── primitives ───────────────────────────────────────────────────────────── */

/** `.lab` — a mono key, a hairline cutting to the margin, and optional hints
 *  hung past it. Every block in the section opens with one. */
function Lab({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 uppercase"
      style={{ fontFamily: MONO, fontSize: 7, fontWeight: 500, letterSpacing: "0.18em", color: LAB_DIM }}
    >
      <span className="flex-none" style={{ marginRight: "-0.18em" }}>{children}</span>
      <i className="h-px flex-1" style={{ background: BORDER }} />
      {hint}
    </div>
  );
}

/** A block the live section drops outright when its data is missing. Name what
 *  won't ship rather than draw an empty shape that reads as a styling bug. */
function Skipped({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[8px] border border-dashed px-2 py-2.5 text-center text-[7.5px] italic ${className ?? ""}`}
      style={{ borderColor: BORDER, color: FAINT }}
    >
      {children}
    </div>
  );
}

/** Preview-only aside: a string the site is showing because the CMS field behind
 *  it is empty, or a value only the live site can compute. */
function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[7px] italic leading-[1.5] ${className ?? ""}`} style={{ color: FAINT }}>
      {children}
    </p>
  );
}

/** The signal-strength meter every dial row carries — four rising bars, still,
 *  since they only dance under a pointer the pane doesn't have. */
function Bars() {
  return (
    <span className="flex flex-none items-end gap-[1.5px]" aria-hidden="true">
      {[3, 4.5, 6, 7.5].map((h) => (
        <i key={h} className="w-[1.5px] rounded-[1px]" style={{ height: h, background: "rgba(250,250,250,0.4)" }} />
      ))}
    </span>
  );
}

/** `.fq` — band, name, a dashed run of dead air, the handle, the meter, the
 *  arrow. `note` is the pane's own voice, so it hangs below the row rather than
 *  inside it. */
function Fq({ band, name, handle, note }: { band: string; name: string; handle: string; note?: string }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 py-[7px]">
        <span
          className="flex-none"
          style={{ fontFamily: MONO, fontSize: 6.5, letterSpacing: "0.08em", color: LAB_DIM, width: 28 }}
        >
          {band}
        </span>
        <span className="min-w-0 truncate text-[8.5px] font-medium text-[#fafafa]" style={{ letterSpacing: "-0.01em" }}>
          {name}
        </span>
        <i className="min-w-3 flex-1" style={{ borderTop: `1px dashed ${BORDER}` }} aria-hidden="true" />
        {/* The site hides the handle under 560px; the pane keeps it and lets it
            truncate, because on this page the handle is the edited field. */}
        <span className="min-w-0 truncate" style={{ fontFamily: MONO, fontSize: 6.5, color: MUTED }}>
          {handle}
        </span>
        <Bars />
        <span className="flex-none text-[7px]" style={{ color: LAB_DIM }} aria-hidden="true">↗</span>
      </div>
      {note ? <Note className="-mt-1 pb-1.5 pl-[36px]">{note}</Note> : null}
    </div>
  );
}

/**
 * The IST wall clock in the header line, mirroring `useIstClock` in Contact.tsx,
 * placeholder included. Formatted after mount only: doing it during render would
 * have the server HTML and the first client pass disagree by a second.
 */
function useIstClock() {
  const [time, setTime] = useState("--:--:--");
  const [awake, setAwake] = useState<boolean | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      try {
        setTime(now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }));
        const hour = parseInt(
          now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit" }),
          10,
        );
        setAwake(hour >= 8 && hour < 24);
      } catch {
        // No IANA database in this runtime — same fallback the site takes.
        setTime(now.toLocaleTimeString("en-GB", { hour12: false }));
        setAwake(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return { time, awake };
}

/* ── the section ──────────────────────────────────────────────────────────── */

export function ContactPreview({
  purposes,
  availabilityStatus,
  availabilityDetail,
  socialLinks,
  contactEmail,
  resumeUrl,
}: ContactPreviewProps) {
  const { time, awake } = useIstClock();

  const links = socialLinks ?? [];
  // `iconKey` alone, the way Frequencies.tsx sorts these — a row renamed
  // "GitHub (old)" still belongs to the key it was filed under, and a row merely
  // *called* GitHub does not get the fold.
  const keyOf = (l: { iconKey?: string }) => (l.iconKey ?? "").trim().toLowerCase();

  const githubLink = links.find((l) => keyOf(l) === "github");
  // The address above is the whole point of the section and GitHub has its own
  // row, so "elsewhere" is everything the dial hasn't already said.
  const elsewhere = links.filter((l) => keyOf(l) !== "github" && keyOf(l) !== "email");
  const hasDial = Boolean(githubLink) || elsewhere.length > 0 || Boolean(resumeUrl);

  const status = (availabilityStatus ?? "").trim();
  const detail = (availabilityDetail ?? "").trim();
  const caption = status || "type below — the line listens";
  const txNote = detail || "↪ straight to my inbox · reply < 24h";

  const email = (contactEmail ?? "").trim();

  /** The purpose the sentence opens on — `openWith` in SentenceForm.tsx: the
      "just saying hi" row if the CMS has one, whatever is first if it does not.
      Printed verbatim, capitalisation and all, exactly as the site prints it. */
  const opensOn =
    purposes.find((p) => /^just saying hi$/i.test(p.label.trim())) ?? purposes[0];

  const band = (i: number) => BANDS[i % BANDS.length]!;
  const handleOf = (l: { name: string; detail?: string | null }) =>
    l.detail?.trim() || l.name.toLowerCase();

  return (
    // A query container so the section reflows against the pane, not the browser.
    <div className="@container">
      <Lab>contact &mdash; ch.01</Lab>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-[20px] font-bold text-[#fafafa]" style={{ letterSpacing: "-0.03em", lineHeight: 1.08 }}>
          Open a channel.
        </h3>
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          style={{ fontFamily: MONO, fontSize: 7, letterSpacing: "0.04em", color: LAB_2 }}
        >
          <span className="relative flex size-[4px] flex-none" aria-hidden="true">
            <span className="absolute inset-0 rounded-full opacity-75 motion-safe:animate-ping" style={{ background: OK }} />
            <span className="relative size-[4px] rounded-full" style={{ background: OK }} />
          </span>
          <span className="tabular-nums text-[#fafafa]">{time}</span>
          <span>IST</span>
          <span>· {awake === false ? "sleeping =^..^=" : "online"}</span>
        </span>
      </div>

      {/* ── the instrument ──
          Bounded top and bottom by a hairline and by nothing else: the trace is
          the only thing inside it, and the two mono lines are laid over the
          wave rather than stacked around it. */}
      <div className="relative mt-3" style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <svg viewBox="0 0 660 64" preserveAspectRatio="none" className="block h-16 w-full" aria-hidden="true">
          <line x1="0" y1="32" x2="660" y2="32" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="1 7" vectorEffect="non-scaling-stroke" />
          {/* the phosphor bloom, then the core stroke over it */}
          <path d={TRACE} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={TRACE} fill="none" stroke="currentColor" strokeOpacity="0.92" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>

        <div
          className="pointer-events-none absolute inset-x-[2px] top-1.5 flex justify-between uppercase"
          style={{ fontFamily: MONO, fontSize: 6.5, letterSpacing: "0.16em", color: LAB_DIM }}
        >
          <span><b className="font-medium" style={{ color: LAB_2, letterSpacing: "0.1em" }}>sig</b> · live</span>
          <span><b className="font-medium" style={{ color: LAB_2, letterSpacing: "0.1em" }}>ch</b> 01 · direct</span>
        </div>
        <div
          className="pointer-events-none absolute inset-x-[2px] bottom-1.5 flex justify-between gap-2 uppercase"
          style={{ fontFamily: MONO, fontSize: 6.5, letterSpacing: "0.14em", color: LAB_DIM }}
        >
          <span className="min-w-0 truncate">{caption}</span>
          <span className="flex-none tabular-nums">amp 0.00</span>
        </div>
      </div>
      {!status ? <Note className="mt-1.5">No availability status &mdash; the scope falls back to that caption</Note> : null}

      {/* ── the sentence ──
          The form is one paragraph with blanks cut into it. Every blank is drawn
          holding its placeholder, which is the state a visitor arrives to. */}
      <p
        className="mt-4 max-w-[60ch] text-[11px]"
        style={{ lineHeight: 1.95, letterSpacing: "-0.014em", fontWeight: 300, color: MUTED }}
      >
        <b className="font-semibold text-[#fafafa]">Hey Yatin</b> &mdash; I&rsquo;m{" "}
        <span
          className="mx-[0.12em] inline-block px-[0.1em] pb-[2px] text-center"
          style={{ borderBottom: `2px solid ${BLANK_RULE}`, color: PLACEHOLDER }}
        >
          your name
        </span>
        {/* With nothing to choose from the site drops the clause rather than
            leaving a picker that opens onto an empty rail, so the sentence runs
            "I'm ___." — this has to drop it too. */}
        {opensOn && (
          <>
            , reaching out about{" "}
            <span
              className="mx-[0.12em] inline-block px-[0.1em] pb-[2px] font-medium text-[#fafafa]"
              style={{ borderBottom: "2px dashed rgba(250,250,250,0.34)" }}
            >
              {opensOn.label}
              <span className="ml-[0.35em] inline-block text-[0.6em] align-[0.15em]" style={{ color: LAB_DIM }}>▾</span>
            </span>
          </>
        )}
        .
        <span className="mt-1.5 block">
          <span
            className="block w-full pb-[6px] pt-[2px]"
            style={{ borderBottom: `2px solid ${BLANK_RULE}`, color: PLACEHOLDER, lineHeight: 1.6 }}
          >
            here&rsquo;s what&rsquo;s on my mind…
          </span>
        </span>
        You can reach me back at{" "}
        <span
          className="mx-[0.12em] inline-block px-[0.1em] pb-[2px] text-center"
          style={{ borderBottom: `2px solid ${BLANK_RULE}`, color: PLACEHOLDER }}
        >
          you@company.com
        </span>
        .
      </p>

      {/* ── the chip rail ──
          On the site this is a 0fr grid until the purpose word is clicked, so
          the honest resting drawing is nothing at all. It is drawn open anyway,
          captioned, because this is the page that edits these chips and a pane
          that hid its own subject would preview nothing — the caption is what
          keeps that from reading as the site's resting state. */}
      {purposes.length > 0 ? (
        <div className="mt-3">
          <Note>
            closed on the site until &ldquo;{opensOn?.label ?? ""}&rdquo; is clicked &mdash; opened here so this page can see its own chips
          </Note>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {purposes.map((p, i) => (
              // Keyed on the index too — `label` is user-editable, not unique,
              // and a half-filled staged create arrives as "".
              <span
                key={`${p.label}-${i}`}
                className="inline-flex items-center rounded-full px-2 py-[3px]"
                style={{
                  fontFamily: MONO,
                  fontSize: 7,
                  letterSpacing: "0.02em",
                  // The one the sentence opens on is pressed, and a pressed chip
                  // inverts — the only filled shape in the section. Matched on
                  // the row itself, not on position: "just saying hi" wins
                  // wherever the CMS has ordered it.
                  color: p === opensOn ? "#0a0a0a" : MUTED,
                  background: p === opensOn ? "#fafafa" : "transparent",
                  border: `1px solid ${p === opensOn ? "#fafafa" : BORDER}`,
                }}
              >
                {`${p.emoji} ${p.label}`.trim()}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <Skipped className="mt-3">
          No purposes yet &mdash; the sentence has no reason to open on and the rail never unfolds
        </Skipped>
      )}

      {/* ── transmit ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="tabular-nums" style={{ fontFamily: MONO, fontSize: 7, color: LAB_DIM }}>0/1000</span>
        <span className="min-w-0 text-[7.5px]" style={{ color: MUTED }}>{txNote}</span>
        <span className="flex-1" />
        {/* The one filled slab in the section, and the only place the pane draws
            the foreground as a background. */}
        <span
          className="inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-[5px] text-[8px] font-semibold"
          style={{ background: "#fafafa", color: "#0a0a0a", letterSpacing: "0.02em" }}
        >
          <span className="flex items-end gap-[1.5px]" aria-hidden="true">
            {[3, 5, 7, 4].map((h, i) => (
              <i key={i} className="w-[1.5px] rounded-[1px]" style={{ height: h, background: "currentColor", opacity: 0.85 }} />
            ))}
          </span>
          Transmit
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-[9px]" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </span>
      </div>
      {!detail ? <Note className="mt-1">No availability detail &mdash; the site prints that fallback line</Note> : null}

      {/* ── the carrier ── */}
      <div className="mt-6">
        {email ? (
          <>
            <Lab>carrier &mdash; email</Lab>
            <div className="mt-2 flex items-center gap-3">
              {/* One weight everywhere and the `@` heavier — on the site the
                  letters are a travelling ripple through Inter's wght axis and
                  the `@` rides 220 above whatever the ripple is holding, which
                  is what carries the break in the line without a second grey.
                  The admin loads no variable Inter, so this is that pivot at
                  static weights. */}
              <span className="min-w-0 break-all text-[17px] text-[#fafafa]" style={{ fontWeight: 500, letterSpacing: "-0.018em", lineHeight: 1.25 }}>
                {Array.from(email).map((ch, i) =>
                  ch === "@" ? <span key={i} style={{ fontWeight: 800 }}>{ch}</span> : ch,
                )}
              </span>
              <span
                className="ml-auto grid size-[22px] flex-none place-items-center rounded-[7px]"
                style={{ border: `1px solid ${BORDER}`, color: MUTED }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="size-[10px]">
                  <rect x="9" y="9" width="12" height="12" rx="2.5" />
                  <path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15" />
                </svg>
              </span>
            </div>
            {/* the wave IS the underline */}
            <svg viewBox="0 0 660 16" preserveAspectRatio="none" className="mt-0.5 block h-4 w-full" aria-hidden="true">
              <path d={CARRIER_WAVE} fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={CARRIER_WAVE} fill="none" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-1 text-right" style={{ fontFamily: MONO, fontSize: 7, color: LAB_DIM }}>
              open in mail ↗
            </div>
          </>
        ) : (
          <Skipped>
            No contact email &mdash; the site draws no address, no carrier wave and no mailto
          </Skipped>
        )}
      </div>

      {/* ── other frequencies ── */}
      <div className="mt-5">
        {hasDial ? (
          <>
            <Lab>other frequencies</Lab>
            <div className="mt-1">
              {githubLink ? (
                <Fq
                  band={band(0)}
                  name={githubLink.name || "—"}
                  // `Frequencies` prints the ledger here when the archive has
                  // one and falls back to the bare handle when it doesn't. The
                  // admin only ever has the fallback.
                  handle={`@${githubLink.detail?.trim().replace("@", "") || "github"}`}
                  note="on the site this row reads contributions · streak · capture date, and unfolds on hover into the year in one line — all of it from the site's own archive"
                />
              ) : null}
              {elsewhere.map((l, i) => (
                <Fq key={`${l.name}-${i}`} band={band(githubLink ? i + 1 : i)} name={l.name || "—"} handle={handleOf(l)} />
              ))}
              {resumeUrl ? (
                // Not a frequency at all — the one thing on the dial you take
                // away with you.
                <Fq band="tape" name="Resume / CV" handle={resumeUrl.includes("drive.google.com") ? "google drive" : "open"} />
              ) : null}
            </div>
            {!resumeUrl ? <Note className="mt-1.5">No resume URL &mdash; the site drops the tape row</Note> : null}
          </>
        ) : (
          <Skipped>No socials and no resume URL &mdash; the whole dial is skipped</Skipped>
        )}
      </div>

      <div
        className="mt-6 flex flex-wrap items-center justify-between gap-2 uppercase"
        style={{ fontFamily: MONO, fontSize: 6.5, letterSpacing: "0.16em", color: LAB_DIM }}
      >
        <span>end of transmission</span>
        <span className="normal-case" style={{ letterSpacing: "0.06em", color: LAB_2 }}>
          12.97°N 77.59°E · bengaluru
        </span>
      </div>
    </div>
  );
}
