'use client';

/**
 * Experience — "commit history"
 *
 * The 6–12 bullet problem: recruiter eye-tracking shows the first bullet gets
 * read ~3.5x more than the fourth and dense walls get skipped, so roles with
 * more than FOLD_AFTER bullets show a MAX_VISIBLE scan layer and fold the rest
 * behind a count-labelled hairline toggle. Folded bullets stay in the DOM
 * (grid-rows 0fr→1fr) so SSR/SEO sees every line. Bullet markers are em
 * dashes in the terminal voice, numeric tokens render as mono "metric anchors"
 * (quantified lines hold recruiter gaze ~2x longer), and the tech chips sit
 * ABOVE the bullets — chips are metadata, they describe the role, and the
 * recruiter scan checks the stack before reading bullet one. Hover: cursor
 * spotlight + sibling dim. Roles with ≤ FOLD_AFTER bullets render everything
 * with no toggle.
 *
 * CMS note: only the first MAX_VISIBLE bullets are visible pre-expand — keep
 * each role's strongest, most quantified achievements at sortOrder 1–3.
 */

import { useId, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { MapPinIcon } from '@repo/ui/icons/brand';
import { skillIconMap } from '@repo/ui/icons/registry';

export interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  website: string | null;
  logoUrl: string | null;
  bullets: string[];
  technologies: string[];
}

/** Scan layer size when a role overflows, and the overflow threshold. */
const MAX_VISIBLE = 3;
const FOLD_AFTER = 4;

/* Bold-lead bullets: "**scan line** rest of the detail".
   NOTE: identical to the parseBullet in landing/Projects.tsx — duplicated on
   purpose; a later pass can hoist one copy into a shared module. */
function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

/* "95%", "100+", "10k+", "40%", "12 minutes" → mono metric anchors. */
const METRIC = /(\d[\d,.]*\s?(?:%|\+|x|k\+?|K\+?|M\+?|hrs?|mins?|minutes?|mos?|yrs?)?)/g;

function MetricizedDetail({ text }: { text: string }) {
  const parts = text.split(METRIC);
  return (
    <>
      {parts.map((part, i) =>
        // split() with a capturing group puts matches at odd indices
        i % 2 === 1 ? (
          <em key={i} className="xp-metric">
            {part}
          </em>
        ) : (
          part
        ),
      )}
    </>
  );
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Absolute month index for a "July 2025"-style string; NaN when unparseable. */
function monthOrdinal(value: string): number {
  if (/present|current|now/i.test(value)) {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth();
  }
  const parts = value.trim().toLowerCase().split(/\s+/);
  const year = Number(parts[1]);
  if (!Number.isFinite(year)) return NaN;
  const token = parts[0] ?? '';
  const month = token.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(token)) : -1;
  return year * 12 + (month === -1 ? 0 : month);
}

/**
 * LinkedIn-style inclusive tenure: "July 2025" → "Present" gives "1 yr 1 mo".
 * startDate/endDate are plain strings in this schema, so this parses month
 * names rather than Date objects. Returns '' when unparseable so the pill is
 * simply omitted.
 */
function tenure(start: string, end: string, isCurrent: boolean): string {
  const from = monthOrdinal(start);
  const to = isCurrent ? monthOrdinal('present') : monthOrdinal(end);
  const months = to - from + 1;
  if (!(months > 0)) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const out: string[] = [];
  if (years) out.push(`${years} yr${years > 1 ? 's' : ''}`);
  if (rest) out.push(`${rest} mo${rest > 1 ? 's' : ''}`);
  return out.join(' ');
}

function LogLine({ bullet, index }: { bullet: string; index: number }) {
  const { highlight, detail } = parseBullet(bullet);
  return (
    <li style={{ '--i': index } as React.CSSProperties}>
      <span className="xp-ln" aria-hidden />
      <span>
        <b>{highlight}</b> <MetricizedDetail text={detail} />
      </span>
    </li>
  );
}

function ExperienceCard({ exp }: { exp: ExperienceData }) {
  const duration = tenure(exp.startDate, exp.endDate, exp.isCurrent);
  const endLabel = exp.isCurrent ? exp.endDate || 'Present' : exp.endDate;

  const overflows = exp.bullets.length > FOLD_AFTER;
  const head = overflows ? exp.bullets.slice(0, MAX_VISIBLE) : exp.bullets;
  const rest = overflows ? exp.bullets.slice(MAX_VISIBLE) : [];

  const [open, setOpen] = useState(false);
  const foldId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inView = useInView(cardRef, { once: true, amount: 0.15 });
  const reducedMotion = useReducedMotion();

  /* spotlight follows the cursor — written straight to the element so
     mousemove never re-renders React */
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) {
      // collapsing pulls the page up — don't strand the reader below the fold
      window.setTimeout(
        () => {
          const btn = moreRef.current;
          if (btn && btn.getBoundingClientRect().top < 0) {
            btn.scrollIntoView({
              block: 'center',
              behavior: reducedMotion ? 'auto' : 'smooth',
            });
          }
        },
        reducedMotion ? 0 : 460,
      );
    }
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={onMouseMove}
      className={`xp-card${inView ? ' in' : ''}${open ? ' open' : ''}`}
    >
      <span className={exp.isCurrent ? 'xp-node live' : 'xp-node'} aria-hidden />

      <div className="xp-top">
        <div>
          <div className="xp-co">
            {exp.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={exp.logoUrl}
                alt=""
                aria-hidden
                width={24}
                height={24}
                loading="lazy"
                decoding="async"
              />
            )}
            {exp.website ? (
              <a href={exp.website} target="_blank" rel="noopener noreferrer">
                {exp.company}
              </a>
            ) : (
              <h3 className="xp-name">{exp.company}</h3>
            )}
            {exp.isCurrent && (
              <span className="xp-cur">
                <i />
                Current
              </span>
            )}
          </div>
          <p className="xp-pos">{exp.position}</p>
        </div>

        <div className="xp-when">
          <span className="dates">
            {exp.startDate} - {endLabel}
            {duration && <span className="xp-dur">{duration}</span>}
          </span>
          <span className="loc">
            <MapPinIcon className="" />
            {exp.location}
          </span>
        </div>
      </div>

      {/* the stack is metadata — it describes the role, so it sits with the
          role header and never moves when the fold opens */}
      {exp.technologies.length > 0 && (
        <div className="xp-badges">
          {exp.technologies.map((tech) => {
            const icon = skillIconMap[tech];
            return (
              <span key={tech} className="badge skill-inner-shadow">
                {icon && <span className="bi">{icon}</span>}
                {tech}
              </span>
            );
          })}
        </div>
      )}

      {/* the scan layer — first MAX_VISIBLE achievements */}
      <ul className="xp-log">
        {head.map((bullet, i) => (
          <LogLine key={i} bullet={bullet} index={i} />
        ))}
      </ul>

      {overflows && (
        <>
          {/* bullets 4..n never leave the DOM — SSR & crawlers see everything */}
          <div className="xp-fold" id={foldId}>
            <div>
              <ul className="xp-log">
                {rest.map((bullet, i) => (
                  <LogLine key={i} bullet={bullet} index={i + MAX_VISIBLE} />
                ))}
              </ul>
            </div>
          </div>
          <div className="xp-veil" aria-hidden />
          <button
            ref={moreRef}
            type="button"
            className="xp-more"
            aria-expanded={open}
            aria-controls={foldId}
            onClick={toggle}
          >
            <span className="lbl">
              {open ? 'show less' : `+ ${rest.length} more`}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>
        </>
      )}
    </div>
  );
}

export default function Experience({ experiences }: { experiences: ExperienceData[] }) {
  return (
    <section id="experience">
      <Container className="mt-20 animate-fade-in-blur animate-delay-2">
        <SectionHeading subHeading="Career" heading="Experience" />
        <div className="xp-list">
          <span className="xp-rail" aria-hidden />
          {experiences.map((exp) => (
            <ExperienceCard key={`${exp.company}-${exp.startDate}`} exp={exp} />
          ))}
        </div>
      </Container>
    </section>
  );
}
