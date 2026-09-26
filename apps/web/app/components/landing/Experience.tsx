'use client';

import { useId, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { MapPinIcon } from '@repo/ui/icons/brand';
import { skillIconMap } from '@repo/ui/icons/registry';
import { slugify } from '@/lib/utils';

export interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startedOn: string | Date;
  endedOn: string | Date | null;
  website: string | null;
  logoUrl: string | null;
  visibleBullets: number;
  bullets: string[];
  technologies: string[];
}

const DEFAULT_VISIBLE_BULLETS = 4;

function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

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

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function monthLabel(value: string | Date): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : MONTH_YEAR.format(d);
}

function monthOrdinal(value: string | Date): number {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? NaN : d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function tenure(startedOn: string | Date, endedOn: string | Date | null): string {
  const now = new Date();
  const from = monthOrdinal(startedOn);
  const to = endedOn === null ? now.getUTCFullYear() * 12 + now.getUTCMonth() : monthOrdinal(endedOn);
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
  const current = exp.endedOn === null;
  const duration = tenure(exp.startedOn, exp.endedOn);
  const endLabel = exp.endedOn === null ? 'Present' : monthLabel(exp.endedOn);

  const visible = exp.visibleBullets > 0 ? exp.visibleBullets : DEFAULT_VISIBLE_BULLETS;
  const overflows = exp.bullets.length > visible;
  const head = overflows ? exp.bullets.slice(0, visible) : exp.bullets;
  const rest = overflows ? exp.bullets.slice(visible) : [];

  const [open, setOpen] = useState(false);
  const foldId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inView = useInView(cardRef, { once: true, amount: 0.15 });
  const reducedMotion = useReducedMotion();

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
      id={`xp-${slugify(exp.company)}`}
      onMouseMove={onMouseMove}
      className={`xp-card scroll-mt-24${inView ? ' in' : ''}${open ? ' open' : ''}`}
    >
      <span className={current ? 'xp-node live' : 'xp-node'} aria-hidden />

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
            <h3 className="xp-name">
              {exp.website ? (
                <a href={exp.website} target="_blank" rel="noopener noreferrer">
                  {exp.company}
                </a>
              ) : (
                exp.company
              )}
            </h3>
            {current && (
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
            {monthLabel(exp.startedOn)} - {endLabel}
            {duration && <span className="xp-dur">{duration}</span>}
          </span>
          <span className="loc">
            <MapPinIcon className="" />
            {exp.location}
          </span>
        </div>
      </div>

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

      <ul className="xp-log">
        {head.map((bullet, i) => (
          <LogLine key={i} bullet={bullet} index={i} />
        ))}
      </ul>

      {overflows && (
        <>
          <div className="xp-fold" id={foldId} inert={!open} aria-hidden={!open}>
            <div>
              <ul className="xp-log">
                {rest.map((bullet, i) => (
                  <LogLine key={i} bullet={bullet} index={i + visible} />
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
        <SectionHeading
          channel="03"
          label="experience"
          title="Where I've shipped."
          hint={`${experiences.length} entries · ${experiences.filter((e) => e.endedOn === null).length} live`}
        />
        <div className="xp-list">
          <span className="xp-rail" aria-hidden />
          {experiences.map((exp) => (
            <ExperienceCard key={`${exp.company}-${exp.position}`} exp={exp} />
          ))}
        </div>
      </Container>
    </section>
  );
}
