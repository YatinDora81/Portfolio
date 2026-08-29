'use client';

import Image from 'next/image';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { GithubIcon, ExternalLinkIcon } from '@repo/ui/icons/brand';
import { skillIconMap } from '@repo/ui/icons/registry';

type ProjectsVersion = 'v1' | 'v2';

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
  health?: { status: 'up' | 'down' | 'unknown'; ms: number | null };
}

interface Endpoint {
  domain: string;
  status: 'live' | 'source';
}

function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

function endpointOf(project: ProjectData): Endpoint | null {
  const parse = (href: string | null) => {
    if (!href) return null;
    try {
      const url = new URL(href);
      const web = url.protocol === 'https:' || url.protocol === 'http:';
      return web && url.hostname ? url : null;
    } catch {
      return null;
    }
  };
  const live = parse(project.live);
  if (live) return { domain: live.hostname.replace(/^www\./, ''), status: 'live' };
  const repo = parse(project.github);
  if (repo) return { domain: `github.com${repo.pathname.replace(/\/$/, '')}`, status: 'source' };
  return null;
}

const FEATURED = 3;
const FOLD_ID = 'pj-more-builds';

function useOpenSet() {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set<number>());
  const toggle = (index: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return [open, toggle] as const;
}

const tapToggle = (onToggle: () => void) => (e: ReactMouseEvent<HTMLElement>) => {
  if ((e.target as Element).closest('a')) return;
  onToggle();
};

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function Highlights({ bullets }: { bullets: string[] }) {
  return (
    <ul className="bullets rv-stagger">
      {bullets.map((bullet, i) => {
        const { highlight, detail } = parseBullet(bullet);
        return (
          <li key={i} style={{ '--i': i } as CSSProperties}>
            <i />
            <span><b>{highlight}</b> {detail}</span>
          </li>
        );
      })}
    </ul>
  );
}

function MoreBuilds({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return (
    <div className={`pj-fold${expanded ? ' open' : ''}`} id={FOLD_ID} inert={!expanded}>
      <div>
        <div className="pj-div mono">more builds</div>
        {children}
      </div>
    </div>
  );
}

function ShowMore({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`show-more pj-more${expanded ? ' open' : ''}`}
      aria-expanded={expanded}
      aria-controls={FOLD_ID}
      onClick={onToggle}
    >
      {expanded ? 'Show Fewer Projects' : 'Show More Projects'}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

function LedgerRow({
  project,
  index,
  isOpen,
  onToggle,
}: {
  project: ProjectData;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const link = project.live ?? project.github;
  const cover = project.images[0];

  return (
    <article className={`pj-row expand${isOpen ? ' open' : ''}`} onClick={tapToggle(onToggle)}>
      <span className="pj-idx mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>

      {cover && link ? (
        <a className="pj-media" href={link} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
          <Image src={cover} alt="" width={300} height={188} sizes="(max-width: 720px) 420px, 300px" loading="lazy" />
        </a>
      ) : (
        <span className="pj-media">
          {cover && (
            <Image src={cover} alt="" width={300} height={188} sizes="(max-width: 720px) 420px, 300px" loading="lazy" />
          )}
        </span>
      )}

      <div>
        <div className="pj-head">
          {project.logoUrl && (
            <Image className="pl" src={project.logoUrl} alt="" aria-hidden width={20} height={20} loading="lazy" />
          )}
          {link ? (
            <a className="pj-title" href={link} target="_blank" rel="noopener noreferrer">
              {project.title}
              <ArrowUpRight />
            </a>
          ) : (
            <span className="pj-title">{project.title}</span>
          )}
          <span className="pj-hint mono" aria-hidden="true">highlights &#9656;</span>
        </div>

        <p className="pj-sum">{project.summary}</p>

        <div className="pj-x">
          <div className="pj-xin">
            <Highlights bullets={project.bullets} />
          </div>
        </div>

        {/* the stack as prose, not pills */}
        <p className="pj-stack mono">
          {project.technologies.map((tech, i) => (
            <Fragment key={tech.name}>
              {i > 0 && <> <em>&middot;</em> </>}
              {tech.name}
            </Fragment>
          ))}
        </p>

        <div className="pj-links mono">
          {project.live && (
            <a href={project.live} target="_blank" rel="noopener noreferrer">
              <span className="pj-dot" aria-hidden="true" />live demo
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

function ProjectsLedger({ projects }: { projects: ProjectData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [open, toggle] = useOpenSet();

  const featured = projects.slice(0, FEATURED);
  const rest = projects.slice(FEATURED);

  const row = (project: ProjectData, index: number) => (
    <LedgerRow
      key={project.title}
      project={project}
      index={index}
      isOpen={open.has(index)}
      onToggle={() => toggle(index)}
    />
  );

  return (
    <section id="projects" className="pj-v1">
      <Container className="mt-20 animate-fade-in-blur animate-delay-3">
        <SectionHeading channel="04" label="projects" title="Build log." hint={`${projects.length} builds`} />
        {projects.length > 0 && (
          <p className="pj-note">
            {projects.length} {projects.length === 1 ? 'thing' : 'things'} shipped end to end — hover
            a row to spotlight it, tap or click for the highlights.
          </p>
        )}

        {/* sibling of the list: nesting stacks two hairlines */}
        <div className="pj-list">{featured.map(row)}</div>

        {rest.length > 0 && (
          <MoreBuilds expanded={expanded}>
            <div className="pj-fold-list">
              {rest.map((project, i) => row(project, FEATURED + i))}
            </div>
          </MoreBuilds>
        )}

        {rest.length > 0 && (
          <ShowMore expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} />
        )}
      </Container>
    </section>
  );
}

const TYPE_DELAY = 180;
const TYPE_STEP = 16;
const CARET_HOLD = 650;

function LogEntry({
  project,
  endpoint,
  index,
  isOpen,
  onToggle,
  reduced,
}: {
  project: ProjectData;
  endpoint: Endpoint | null;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  reduced: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -6% 0px', amount: 0.05 });
  const link = project.live ?? project.github;
  const cover = project.images[0];
  const domain = endpoint?.domain;

  const [typed, setTyped] = useState<string | null>(null);
  const [caret, setCaret] = useState(false);

  useEffect(() => {
    if (!domain || reduced || !inView) return;
    let timer: ReturnType<typeof setTimeout>;
    let k = 0;
    const tick = () => {
      setTyped(domain.slice(0, k));
      if (k < domain.length) {
        k += 1;
        timer = setTimeout(tick, TYPE_STEP);
      } else {
        timer = setTimeout(() => setCaret(false), CARET_HOLD);
      }
    };
    timer = setTimeout(() => {
      setCaret(true);
      tick();
    }, TYPE_DELAY);
    return () => clearTimeout(timer);
  }, [domain, reduced, inView]);

  const shown = inView;

  return (
    <article
      ref={ref}
      className={`pjb-entry${shown ? ' in' : ''}${isOpen ? ' open' : ''}`}
      onClick={tapToggle(onToggle)}
    >
      <div className="pjb-dep mono">
        <span className="pjb-n">{String(index + 1).padStart(2, '0')}</span>
        {domain && <span className="pjb-d">{typed ?? domain}</span>}
        {caret && <span className="pjb-caret" aria-hidden="true">&#9613;</span>}
        <i style={{ '--fd': `${(index * 1.1).toFixed(1)}s` } as CSSProperties} aria-hidden="true" />
        {endpoint && (
          <span className="pjb-s">
            {endpoint.status === 'live' && <span className="pj-dot" aria-hidden="true" />}
            {endpoint.status}
          </span>
        )}
      </div>

      <div className="pjb-grid">
        <div className="pjb-pad">
          {/* prod tab only where there is a live url */}
          {endpoint?.status === 'live' && (
            <span className="pjb-prod mono" aria-hidden="true">
              &#9650; prod
              {project.health && project.health.status !== 'unknown' && (
                <>
                  {' · '}
                  <span className={project.health.status === 'up' ? 'up' : 'down'}>{project.health.status}</span>
                  {project.health.ms !== null && (
                    <>
                      {' · '}
                      <span className="ms">{project.health.ms} ms</span>
                    </>
                  )}
                </>
              )}
            </span>
          )}
          {cover && link ? (
            <a className="pjb-thumb" href={link} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
              <Image src={cover} alt="" width={280} height={175} sizes="(max-width: 600px) 230px, 280px" loading="lazy" />
            </a>
          ) : (
            <span className="pjb-thumb">
              {cover && (
                <Image src={cover} alt="" width={280} height={175} sizes="(max-width: 600px) 230px, 280px" loading="lazy" />
              )}
            </span>
          )}
        </div>

        <div>
          <div className="pjb-title">
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
            <span className="pjb-hint mono" aria-hidden="true">highlights</span>
          </div>

          <p className="pjb-sum">{project.summary}</p>

          <div className="pjb-x">
            <div className="pjb-xin">
              <Highlights bullets={project.bullets} />
            </div>
          </div>

          <div className="pjb-chips">
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

          <div className="pjb-links mono">
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
      </div>
    </article>
  );
}

function ProjectsBuildLog({ projects }: { projects: ProjectData[] }) {
  const [expanded, setExpanded] = useState(false);
  const [open, toggle] = useOpenSet();
  const reduced = useReducedMotion() ?? false;

  const endpoints = projects.map(endpointOf);
  const liveCount = endpoints.filter((e) => e?.status === 'live').length;
  const allLive = projects.length > 0 && liveCount === projects.length;
  const timings = projects.map((p) => p.health?.ms).filter((ms): ms is number => typeof ms === 'number');
  const avgMs = timings.length ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : null;

  const featured = projects.slice(0, FEATURED);
  const rest = projects.slice(FEATURED);

  const entry = (project: ProjectData, index: number) => (
    <LogEntry
      key={project.title}
      project={project}
      endpoint={endpoints[index] ?? null}
      index={index}
      isOpen={open.has(index)}
      onToggle={() => toggle(index)}
      reduced={reduced}
    />
  );

  return (
    <section id="projects" className="pj-v2">
      <Container className="mt-20 animate-fade-in-blur animate-delay-3">
        <SectionHeading channel="04" label="projects" title="Build log." hint={`${projects.length} builds`} />
        <p className="pj-note">
          <span className="mono" aria-hidden="true">&#8982;</span>{' '}
          {allLive && 'every build below is deployed & running — '}
          tap or hover a build for the highlights
        </p>

        <div className="pjb-log">
          {featured.map(entry)}

          {rest.length > 0 && (
            <MoreBuilds expanded={expanded}>
              <div>{rest.map((project, i) => entry(project, FEATURED + i))}</div>
            </MoreBuilds>
          )}
        </div>

        {rest.length > 0 && (
          <ShowMore expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} />
        )}

        {projects.length > 0 && (
          <p className="pjb-eol mono">
            end of build log &middot; {liveCount}/{projects.length} live
            {avgMs !== null && <> &middot; <span className="text-foreground">avg {avgMs} ms</span></>}
          </p>
        )}
      </Container>
    </section>
  );
}

export default function Projects({
  version,
  projects,
}: {
  version: ProjectsVersion;
  projects: ProjectData[];
}) {
  return version === 'v1' ? (
    <ProjectsLedger projects={projects} />
  ) : (
    <ProjectsBuildLog projects={projects} />
  );
}
