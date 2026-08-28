'use client';

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import type { GithubActivity } from '../../../lib/github';
import type { SocialLink } from '../Contact';

interface FrequenciesProps {
  socialLinks: SocialLink[];
  resumeUrl: string;
  github: GithubActivity | null;
}

const BANDS = ['88.1', '94.3', '101.5', '107.9', '89.7', '96.5', '104.3', '92.7', '99.1'];

const VW = 660;
const VH = 60;
const PT = 16;
const PB = 8;
const BASE = VH - PB;

const fx = (v: number) => v.toFixed(2);
const xOf = (i: number, n: number) => (i / (n - 1)) * (VW - 4) + 2;
const yOf = (v: number, maxV: number) => (maxV > 0 ? BASE - (v / maxV) * (BASE - PT) : BASE);

interface Line {
  n: number;
  firstD: number;
  lastD: number;
  raw: number[];
  maxV: number;
  peakD: number;
  d: string;
  under: string;
  last: [number, number];
}

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

const LEN_SAMPLES = 200;

function GhLine({ github, line }: { github: GithubActivity; line: Line }) {
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);
  const curLine = useRef<SVGLineElement>(null);
  const curDot = useRef<SVGCircleElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  const inView = useInView(stageRef, { once: true, amount: 0.4 });

  const { n, firstD, lastD, raw, maxV, peakD, d, under, last } = line;
  const total = github.total.toLocaleString('en-US');

  const hasPeak = maxV > 0 && peakD !== lastD;

  const pkHalf = `${(`peak ${maxV}`.length * 0.37).toFixed(2)}em`;

  // all UTC; local getters read back a day early
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

      // 1.5% over so rounding cannot clip the tip
      const draw = ((screenLen * devicePixelRatio) / userLen) * 1.015;
      if (!Number.isFinite(draw) || draw < 0.2 || draw > 24) return;
      path.style.setProperty('--draw', draw.toFixed(3));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
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

          <div className="ghln-stage" ref={stageRef} onPointerMove={scrub}>
            <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>

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

              <path className="stroke" ref={strokeRef} pathLength="1" d={d} />
              {hasPeak && (
                <circle className="pkdot" cx={fx(xOf(peakD, n))} cy={fx(yOf(maxV, maxV))} r="1.8" />
              )}
              <line className="cur" ref={curLine} x1="0" y1={PT - 6} x2="0" y2={BASE} />
              <circle className="curdot" ref={curDot} cx="0" cy="0" r="2.6" />
            </svg>

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
  const line = useMemo(() => (github ? buildLine(github.weeks) : null), [github]);

  const githubLink = socialLinks.find((l) => l.iconKey === 'github');
  const elsewhere = socialLinks.filter((l) => l.iconKey !== 'github' && l.iconKey !== 'email');
  if (!githubLink && elsewhere.length === 0 && !resumeUrl) return null;

  const band = (i: number) => BANDS[i % BANDS.length]!;
  const ghHandle =
    github?.handle ??
    githubLink?.detail?.replace('@', '') ??
    githubLink?.href.match(/github\.com\/([^/?#]+)/i)?.[1] ??
    'github';
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
