'use client';

import { useState, useEffect } from 'react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import SkillBadge from '../common/SkillBadge';
import { MapPinIcon } from '../icons';

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}

interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  bullets: string[];
  technologies: string[];
  website: string | null;
}

function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

const INITIAL_COUNT = 2;

function ExperienceCard({ exp, alwaysRevealed = false }: { exp: ExperienceData; alwaysRevealed?: boolean }) {
  const isMobile = useIsMobile();
  const mobileVisibleCount = INITIAL_COUNT + 1;
  const visibleCount = isMobile ? mobileVisibleCount : INITIAL_COUNT;
  const hasMore = exp.bullets.length > visibleCount;
  const [revealed, setRevealed] = useState(alwaysRevealed);

  const bullets = exp.bullets.map(parseBullet);

  return (
    <div
      className="group/card flex flex-col gap-4 rounded-xl border border-transparent p-4 -mx-4 transition-colors duration-300 hover:border-border hover:bg-card"
      onMouseEnter={() => { if (!isMobile && hasMore && !revealed) setRevealed(true); }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            {exp.website ? (
              <a
                href={exp.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-bold hover:underline underline-offset-4"
              >
                {exp.company}
              </a>
            ) : (
              <h3 className="text-lg font-bold">{exp.company}</h3>
            )}
            {exp.isCurrent && (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
                <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
                Current
              </span>
            )}
          </div>
          <p className="text-secondary text-sm">{exp.position}</p>
        </div>
        <div className="text-secondary flex flex-col text-sm sm:text-right">
          <span>{exp.startDate} - {exp.endDate}</span>
          <span className="inline-flex items-center gap-1 sm:justify-end">
            <MapPinIcon className="size-3" />
            {exp.location}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {exp.technologies.map((tech) => (
          <SkillBadge key={tech} name={tech} />
        ))}
      </div>

      <ul className="space-y-3 text-sm leading-relaxed">
        {bullets.slice(0, visibleCount).map((bullet, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
            <span className="text-secondary">
              <span className="text-foreground font-medium">{bullet.highlight}</span>
              {' '}{bullet.detail}
            </span>
          </li>
        ))}

        {!isMobile && hasMore && !revealed && (
          <div className="relative">
            <ul className="space-y-3 blur-[3px] opacity-50 select-none">
              {bullets.slice(visibleCount).map((bullet, i) => (
                <li key={i + visibleCount} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                  <span className="text-secondary">
                    <span className="text-foreground font-medium">{bullet.highlight}</span>
                    {' '}{bullet.detail}
                  </span>
                </li>
              ))}
            </ul>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-secondary pointer-events-none">
              Show more
            </span>
          </div>
        )}

        {hasMore && revealed && (
          <ul className="space-y-3">
            {bullets.slice(visibleCount).map((bullet, i) => (
              <li
                key={i + visibleCount}
                className="flex gap-3 animate-fade-in-blur"
                style={{ animationDelay: `${(i + 1) * 80}ms` }}
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                <span className="text-secondary">
                  <span className="text-foreground font-medium">{bullet.highlight}</span>
                  {' '}{bullet.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ul>

      {isMobile && hasMore && !revealed && (
        <div className="relative">
          <ul className="space-y-3 text-sm leading-relaxed blur-[3px] opacity-50 select-none">
            {bullets.slice(visibleCount, visibleCount + 1).map((bullet, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                <span className="text-secondary">
                  <span className="text-foreground font-medium">{bullet.highlight}</span>
                  {' '}{bullet.detail}
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center cursor-pointer bg-transparent border-none"
          >
            <span className="text-xs font-medium text-secondary">Show more +</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function Experience({ experiences }: { experiences: ExperienceData[] }) {
  return (
    <section id="experience">
      <Container className="mt-20 animate-fade-in-blur animate-delay-2">
        <SectionHeading subHeading="Career" heading="Experience" />
        <div className="mt-6 flex flex-col gap-6">
          {experiences.map((exp, i) => (
            <ExperienceCard key={exp.company} exp={exp} alwaysRevealed={i === 0} />
          ))}
        </div>
      </Container>
    </section>
  );
}
