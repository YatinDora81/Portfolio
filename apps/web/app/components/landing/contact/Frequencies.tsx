'use client';

/**
 * Frequencies — the FM dial, and the year in one line.
 *
 * The line reads the year AT THE WEEK on purpose: a daily series is a
 * fifty-two-tooth comb at this width, and smoothing it into a mean only trades
 * that for a curve squashed into the bottom of the panel by the year's single
 * busiest day.
 *
 * Built once from the props and then never touched by React again — the scrub
 * hairline and readout are written straight to their nodes.
 */

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import type { GithubActivity } from '../../../lib/github';
import type { SocialLink } from '../Contact';

interface FrequenciesProps {
  socialLinks: SocialLink[];
  resumeUrl: string;
  github: GithubActivity | null;
}

/** Assigned by position, not stored: a band is an ordinal dressed as a dial
    reading. It cycles rather than running out if the CMS ever grows past nine. */
const BANDS = ['88.1', '94.3', '101.5', '107.9', '89.7', '96.5', '104.3', '92.7', '99.1'];

/* ── the line ───────────────────────────────────────────────────────────── */

/** A fixed viewBox stretched to whatever width the column has. The stroke is
    non-scaling, so squashing 660 units into 300px thins nothing. */
const VW = 660;
const VH = 60;
const PT = 16;
const PB = 8;
const BASE = VH - PB;

const fx = (v: number) => v.toFixed(2);
const xOf = (i: number, n: number) => (i / (n - 1)) * (VW - 4) + 2;
/** A silent year has no scale to divide by, so it lies flat on the baseline. */
const yOf = (v: number, maxV: number) => (maxV > 0 ? BASE - (v / maxV) * (BASE - PT) : BASE);

interface Line {
  n: number;
  /** The first and last weeks the archive can speak for. Everything drawn, and
      everything the scrub can land on, lives between them. */
  firstD: number;
  lastD: number;
  /** The weekly totals, nulls read as zero for the curve's sake. */
  raw: number[];
  /** The busiest week, and where it fell. */
  maxV: number;
  peakD: number;
  /** The stroke, and the same curve closed down to the baseline for the fill. */
  d: string;
  under: string;
  last: [number, number];
}

/** Weekly totals → one catmull-rom path. Returns null for a year that cannot be
    drawn honestly, which the caller uses to drop the chevron too. */
function buildLine(days: (number | null)[]): Line | null {
  const n = days.length;
  const firstD = days.findIndex((v) => v !== null);
  let lastD = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (days[i] !== null) {
      lastD = i;
      break;
    }
  }
  if (n < 2 || firstD < 0 || lastD - firstD < 1) return null;

  // Defensive: nulls only occur at the head and tail, and reading a middle one
  // as zero keeps the stroke continuous instead of splitting it in two.
  const raw = days.map((v) => v ?? 0);

  let peakD = firstD;
  for (let i = firstD + 1; i <= lastD; i++) {
    if (raw[i]! > raw[peakD]!) peakD = i;
  }
  const maxV = raw[peakD]!;

  const P: [number, number][] = [];
  for (let i = firstD; i <= lastD; i++) P.push([xOf(i, n), yOf(raw[i]!, maxV)]);

  const head = P[0]!;
  let d = `M${fx(head[0])},${fx(head[1])}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i]!;
    const p1 = P[i]!;
    const p2 = P[i + 1]!;
    const p3 = P[i + 2] ?? p2;
    d +=
      `C${fx(p1[0] + (p2[0] - p0[0]) / 6)},${fx(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${fx(p2[0] - (p3[0] - p1[0]) / 6)},${fx(p2[1] - (p3[1] - p1[1]) / 6)} ` +
      `${fx(p2[0])},${fx(p2[1])}`;
  }
  const last = P[P.length - 1]!;

  return {
    n,
    firstD,
    lastD,
    raw,
    maxV,
    peakD,
    d,
    under: `${d}L${fx(last[0])},${BASE}L${fx(head[0])},${BASE}Z`,
    last,
  };
}

/** Enough to hold the sampled length within a fraction of a pixel on a curve
    this shallow, and cheap enough to redo on every resize. */
const LEN_SAMPLES = 200;

function GhLine({ github, line }: { github: GithubActivity; line: Line }) {
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);
  const curLine = useRef<SVGLineElement>(null);
  const curDot = useRef<SVGCircleElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  // Touch has no dwell to spend, so the panel is open from first paint there and
  // the stroke waits for the scroll. On a pointer machine this class does
  // nothing — the fold's own hover rules draw it.
  const inView = useInView(stageRef, { once: true, amount: 0.4 });

  const { n, firstD, lastD, raw, maxV, peakD, d, under, last } = line;
  const total = github.total.toLocaleString('en-US');

  // A year with nothing in it has no busiest week. Without the maxV guard the
  // marker still renders — "peak 0", pinned to the baseline, on top of the flat
  // line it is supposedly the high point of.
  const hasPeak = maxV > 0 && peakD !== lastD;

  // Half the peak label, in its own em: the mono advances .6em a glyph and
  // `letter-spacing: .14em` trails every one of them, so the label is .74em a
  // character. Derived rather than measured — a layout read would cost the one
  // thing this component promises, which is never touching the DOM to draw.
  const pkHalf = `${(`peak ${maxV}`.length * 0.37).toFixed(2)}em`;

  // All UTC: `new Date('2025-08-02')` read back with local getters is yesterday
  // for everyone west of Greenwich.
  const weekLabel = useMemo(() => {
    const t0 = Date.parse(`${github.startDate}T00:00:00Z`);
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    return (i: number) =>
      Number.isNaN(t0)
        ? `t−${n - 1 - i}w`
        : fmt.format(new Date(t0 + i * 7 * 86_400_000)).toLowerCase();
  }, [github.startDate, n]);

  /* How long the dash has to be for the line to finish drawing — see the
     `--draw` note in globals.css. The number is the curve's length in the space
     `non-scaling-stroke` strokes in, over its length in the space `pathLength`
     normalises against, and neither the column's width nor the display's pixel
     ratio is knowable from a stylesheet. Measured off the real path so it is
     right on every screen, and re-measured whenever either one moves. */
  useEffect(() => {
    const path = strokeRef.current;
    const svg = path?.ownerSVGElement;
    if (!path || !svg) return;

    const measure = () => {
      const ctm = path.getScreenCTM();
      const userLen = path.getTotalLength();
      if (!ctm || userLen === 0) return;

      let screenLen = 0;
      let px = 0;
      let py = 0;
      for (let i = 0; i <= LEN_SAMPLES; i++) {
        const p = path.getPointAtLength((userLen * i) / LEN_SAMPLES);
        const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
        const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
        if (i > 0) screenLen += Math.hypot(x - px, y - py);
        px = x;
        py = y;
      }

      // 1.5% over, so the last few device pixels of the tip cannot be lost to
      // rounding — the cost is that the draw lands a frame early, which is
      // nothing next to a line that stops short of its own live dot.
      const draw = ((screenLen * devicePixelRatio) / userLen) * 1.015;
      // A ratio this far out means the panel was measured before it had any
      // layout to measure; the observer comes back when it does.
      if (!Number.isFinite(draw) || draw < 0.2 || draw > 24) return;
      path.style.setProperty('--draw', draw.toFixed(3));
    };

    // Directly as well as through the observer: a ResizeObserver's first
    // delivery waits for a rendering opportunity, and a tab that mounts in the
    // background does not get one until it is looked at.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    // A resize is what the column reports; a zoom only shows up as a new ratio.
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    // Clamped to the drawn run, not to the viewBox: past lastD there is no
    // curve to ride and the dot would sit on the baseline reading zero.
    const i = Math.max(
      firstD,
      Math.min(lastD, Math.round(((e.clientX - box.left) / box.width) * (n - 1))),
    );
    const v = raw[i] ?? 0;
    const x = String(xOf(i, n));
    curLine.current?.setAttribute('x1', x);
    curLine.current?.setAttribute('x2', x);
    curDot.current?.setAttribute('cx', x);
    curDot.current?.setAttribute('cy', String(yOf(v, maxV)));
    if (readout.current) {
      // The last column is the current week, and it is short by however many
      // days are still to come — "this wk" says that; a date would not.
      const live = github.streak > 0 && i > lastD - Math.ceil(github.streak / 7);
      readout.current.textContent =
        `${i === n - 1 ? 'this wk' : `wk of ${weekLabel(i)}`} · ${v} ${v === 1 ? 'commit' : 'commits'}` +
        `${live ? ' · live' : ''}`;
    }
  };

  return (
    <div
      className={`ghln${inView || reduced ? ' in' : ''}`}
      role="img"
      aria-label={
        `A year of GitHub contributions drawn as one line, a week at a time: ` +
        `${total} contributions, ${github.streak}-day live streak, best run ` +
        `${github.best} days, busiest week ${maxV} beginning ${weekLabel(peakD)}, ` +
        `as of ${github.asOf}.`
      }
    >
      <div className="ghln-in">
        <div className="ghln-body">
          {/* aria-hidden on the svg: role="img" above already hides the subtree,
              and a screen reader should get one sentence, not a year of path
              commands — which is also why the label above carries every fact a
              sighted visitor can scrub the panel for. */}
          <div className="ghln-stage" ref={stageRef} onPointerMove={scrub}>
            <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                {/* one ink. the gradient is time: the past at a whisper, now at full. */}
                <linearGradient id="ghlnInk" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopOpacity=".18" />
                  <stop offset=".55" stopOpacity=".55" />
                  <stop offset="1" stopOpacity="1" />
                </linearGradient>
                <linearGradient id="ghlnFade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopOpacity=".09" />
                  <stop offset="1" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line className="base" x1="2" y1={BASE} x2={VW - 2} y2={BASE} />
              <path className="under" d={under} />
              {/* pathLength 1 is what lets the CSS draw it with a dashoffset
                  without knowing how long the year's curve happens to be. */}
              <path className="stroke" ref={strokeRef} pathLength="1" d={d} />
              {hasPeak && (
                <circle className="pkdot" cx={fx(xOf(peakD, n))} cy={fx(yOf(maxV, maxV))} r="1.8" />
              )}
              <line className="cur" ref={curLine} x1="0" y1={PT - 6} x2="0" y2={BASE} />
              <circle className="curdot" ref={curDot} cx="0" cy="0" r="2.6" />
            </svg>

            {/* Percentages off the last point, so the marker tracks the curve
                through every width the fluid viewBox is stretched to. */}
            <i
              className="ghln-dot"
              aria-hidden="true"
              style={{ left: `${(last[0] / VW) * 100}%`, top: `${(last[1] / VH) * 100}%` }}
            />
            {hasPeak && (
              <span
                className="ghln-pk"
                aria-hidden="true"
                style={{
                  // Held off both edges by its own half-width, not by two round
                  // percentages: the label is centred on its point, so how far
                  // in it has to stop depends on how wide it is. A flat 6%/92%
                  // was fine at 716px and wrong on a phone — "peak 128" lost its
                  // first glyph to the panel edge under a ~390px viewport, and
                  // the right stop landed it on the green live dot. The 14px
                  // there is that dot plus the ring it pings.
                  left: `clamp(calc(${pkHalf} + 2px), ${((xOf(peakD, n) / VW) * 100).toFixed(3)}%, calc(100% - ${pkHalf} - 14px))`,
                  top: `${((yOf(maxV, maxV) - 6) / VH) * 100}%`,
                }}
              >
                peak {maxV}
              </span>
            )}
            <span className="ghln-ro" ref={readout} aria-hidden="true" />
          </div>

          <p className="ghln-cap" aria-hidden="true">
            the year in one line — <b>{total}</b> contributions · streak <b>{github.streak}d</b> ·
            best <b>{github.best}d</b> · as of {github.asOf}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── the dial ───────────────────────────────────────────────────────────── */

/** The CMS handle line when there is one; otherwise the bare URL, so a row is
    never left with an empty right cell. */
function handleOf(link: SocialLink) {
  if (link.detail) return link.detail;
  try {
    const url = new URL(link.href);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return link.href;
  }
}

function Fq({
  band,
  name,
  handle,
  href,
  chevron,
}: {
  band: string;
  name: string;
  handle: string;
  href: string;
  /** Only the row with something folded behind it gets one. */
  chevron?: boolean;
}) {
  return (
    <a className="fq" href={href} target="_blank" rel="noopener noreferrer">
      <span className="fq-band">{band}</span>
      <span className="fq-name">{name}</span>
      <span className="fq-line" aria-hidden="true" />
      <span className="fq-h">{handle}</span>
      {chevron && (
        <span className="ghv" aria-hidden="true">
          ⌄
        </span>
      )}
      <span className="bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="fq-arr" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

export default function Frequencies({ socialLinks, resumeUrl, github }: FrequenciesProps) {
  // Depends only on the archive, which arrives whole from the server — the
  // section's clock re-renders this component once a second and must not rebuild
  // a year of bezier every tick.
  const line = useMemo(() => (github ? buildLine(github.weeks) : null), [github]);

  const githubLink = socialLinks.find((l) => l.iconKey === 'github');
  // The address above is the whole point of the section, and GitHub has its own
  // row — "elsewhere" is everything the section hasn't already said.
  const elsewhere = socialLinks.filter((l) => l.iconKey !== 'github' && l.iconKey !== 'email');
  if (!githubLink && elsewhere.length === 0 && !resumeUrl) return null;

  const band = (i: number) => BANDS[i % BANDS.length]!;
  // Falls back to the handle parsed out of the href rather than the literal
  // 'github', which advertised someone else's account whenever the archive was
  // absent and the CMS detail blank — the normal state of a fresh deploy.
  // Parsed here rather than imported from lib/github: that module reaches for
  // prisma, and a value import would drag the server into this client bundle.
  const ghHandle =
    github?.handle ??
    githubLink?.detail?.replace('@', '') ??
    githubLink?.href.match(/github\.com\/([^/?#]+)/i)?.[1] ??
    'github';
  // "as of", never "past year": the numbers come from an archive, and the
  // capture date is the only thing keeping a months-old snapshot from reading as
  // a claim about this week.
  const ghHandleLine = github
    ? [
        `${github.total.toLocaleString('en-US')} contributions`,
        github.streak > 0 ? `${github.streak}d streak` : null,
        `as of ${github.asOf}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : `@${ghHandle}`;

  return (
    <div className="freqs">
      <div className="lab">
        <span>other frequencies</span>
        <i aria-hidden="true" />
      </div>

      <div className="fq-list">
        {githubLink &&
          (line && github ? (
            <div className="fqx">
              <Fq
                band={band(0)}
                name={githubLink.name}
                handle={ghHandleLine}
                href={githubLink.href}
                chevron
              />
              <GhLine github={github} line={line} />
            </div>
          ) : (
            // Nothing drawable behind it, so no chevron and no panel: an
            // affordance that opens onto an empty box is worse than none.
            <Fq band={band(0)} name={githubLink.name} handle={ghHandleLine} href={githubLink.href} />
          ))}

        {elsewhere.map((link, i) => (
          <Fq
            key={link.name}
            band={band(githubLink ? i + 1 : i)}
            name={link.name}
            handle={handleOf(link)}
            href={link.href}
          />
        ))}

        {resumeUrl && (
          // Not a frequency at all — the one thing on the dial you take away
          // with you, so it reads as the tape rather than as another station.
          <Fq
            band="tape"
            name="Resume / CV"
            handle={resumeUrl.includes('drive.google.com') ? 'google drive' : 'open'}
            href={resumeUrl}
          />
        )}
      </div>
    </div>
  );
}
