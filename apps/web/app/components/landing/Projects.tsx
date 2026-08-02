'use client';

import Image from 'next/image';
import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { GithubIcon, ExternalLinkIcon } from '@repo/ui/icons/brand';
import { skillIconMap } from '@repo/ui/icons/registry';

interface TechSkill {
  name: string;
  iconKey: string;
}

interface ProjectData {
  title: string;
  summary: string;
  bullets: string[];
  technologies: TechSkill[];
  github: string | null;
  live: string | null;
  logoUrl: string | null;
  images: string[];
}

/** `**Lead line** rest of the sentence` — the bold lead is the scan line. */
function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

const FEATURED = 3;
const FOLD_ID = 'pj-more-builds';

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function ProjectRow({
  project,
  isOpen,
  onToggle,
}: {
  project: ProjectData;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const link = project.live ?? project.github;
  const thumb = project.images[0];
  const bullets = project.bullets.map(parseBullet);

  // Touch: a tap anywhere on the row toggles it open. Desktop: CSS :hover does
  // it, keyboard: CSS :focus-within does it. Clicks on links always pass through.
  const handleClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('a')) return;
    onToggle();
  };

  return (
    <article className={`pj-row expand${isOpen ? ' open' : ''}`} onClick={handleClick}>
      <span className="pj-hint mono" aria-hidden="true">highlights</span>

      {thumb && link ? (
        <a className="pj-thumb" href={link} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
          <Image src={thumb} alt="" width={176} height={110} sizes="(max-width: 600px) 230px, 176px" loading="lazy" />
        </a>
      ) : thumb ? (
        <span className="pj-thumb">
          <Image src={thumb} alt="" width={176} height={110} sizes="(max-width: 600px) 230px, 176px" loading="lazy" />
        </span>
      ) : (
        <span className="pj-thumb" />
      )}

      <div>
        <div className="pj-title">
          {project.logoUrl && (
            <Image className="pl" src={project.logoUrl} alt="" aria-hidden width={20} height={20} loading="lazy" />
          )}
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer">
              {project.title}
              <ArrowUpRight />
            </a>
          ) : (
            <span className="pj-name">{project.title}</span>
          )}
        </div>

        <p className="pj-sum">{project.summary}</p>

        <div className="pj-x">
          <div className="pj-xin">
            <ul className="bullets rv-stagger">
              {bullets.map((bullet, i) => (
                <li key={i} style={{ '--i': i } as CSSProperties}>
                  <i />
                  <span><b>{bullet.highlight}</b> {bullet.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pj-chips">
          {project.technologies.map((tech) => {
            const icon = skillIconMap[tech.iconKey] || skillIconMap[tech.name];
            return (
              <span key={tech.name} className="badge skill-inner-shadow">
                {icon && <span className="bi">{icon}</span>}
                {tech.name}
              </span>
            );
          })}
        </div>

        <div className="pj-links mono">
          {project.live && (
            <a href={project.live} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon className="" />live demo
            </a>
          )}
          {project.github && (
            <a href={project.github} target="_blank" rel="noopener noreferrer">
              <GithubIcon className="" />source
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Projects({ projects }: { projects: ProjectData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set<number>());

  const toggle = (index: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const featured = projects.slice(0, FEATURED);
  const rest = projects.slice(FEATURED);

  return (
    <section id="projects">
      <Container className="mt-20 animate-fade-in-blur animate-delay-3">
        <SectionHeading subHeading="Work" heading="Projects" />

        <div className="pj-list">
          {featured.map((project, i) => (
            <ProjectRow
              key={project.title}
              project={project}
              isOpen={open.has(i)}
              onToggle={() => toggle(i)}
            />
          ))}

          {/* The overflow projects used to mount only once `expanded` flipped, so
              half the portfolio never reached the served HTML — it existed only
              inside the flight payload, invisible to crawlers, to a reader with
              JS off and to find-in-page. They ship in the markup unconditionally
              now and the fold hides them with CSS instead. `inert` is what makes
              the collapsed state honest: a zero-height fold still holds real
              links that Tab would land on with nothing visible under the focus
              ring, and aria-expanded would be claiming otherwise. */}
          {rest.length > 0 && (
            <div
              className={`pj-fold${expanded ? ' open' : ''}`}
              id={FOLD_ID}
              inert={!expanded}
            >
              <div>
                <div className="pj-div mono">more builds</div>
                {rest.map((project, i) => (
                  <ProjectRow
                    key={project.title}
                    project={project}
                    isOpen={open.has(FEATURED + i)}
                    onToggle={() => toggle(FEATURED + i)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* the button stays mounted and toggles both ways — unmounting it on
            expand dropped keyboard focus onto the body, and a control that
            vanishes can never report the state it controls */}
        {rest.length > 0 && (
          <button
            type="button"
            className={`show-more pj-more${expanded ? ' open' : ''}`}
            aria-expanded={expanded}
            aria-controls={FOLD_ID}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Show Fewer Projects' : 'Show More Projects'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </Container>
    </section>
  );
}
