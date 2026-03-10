'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { GithubIcon, ExternalLinkIcon } from '../icons';
import { skillIconMap } from '@/lib/icon-map';

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
  images: string[];
}

function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

function ImageCarousel({ images, title, link }: { images: string[]; title: string; link: string }) {
  const [current, setCurrent] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startAutoPlay = useCallback(() => {
    if (images.length <= 1) return;
    intervalRef.current = setInterval(() => {
      setCurrent(prev => (prev + 1) % images.length);
    }, 3000);
  }, [images.length]);

  const stopAutoPlay = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  useEffect(() => {
    startAutoPlay();
    return stopAutoPlay;
  }, [startAutoPlay, stopAutoPlay]);

  return (
    <div className="relative group/carousel">
      <a href={link} target="_blank" rel="noopener noreferrer">
        <div className="w-72 h-44 rounded-xl border border-border shadow-2xl overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.img
              key={current}
              src={images[current]}
              alt={`${title} preview ${current + 1}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full h-full object-cover"
            />
          </AnimatePresence>
        </div>
      </a>
      {images.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); stopAutoPlay(); setCurrent(i); startAutoPlay(); }}
              className={`size-2 rounded-full transition-all duration-200 cursor-pointer border-none ${
                i === current ? 'bg-foreground scale-110' : 'bg-foreground/30 hover:bg-foreground/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const INITIAL_PROJECTS = 3;
const INITIAL_BULLETS = 1;

function ProjectCard({ project, alwaysRevealed = false }: { project: ProjectData; alwaysRevealed?: boolean }) {
  const isMobile = useIsMobile();
  const mobileVisibleCount = INITIAL_BULLETS + 1;
  const visibleCount = isMobile ? mobileVisibleCount : INITIAL_BULLETS;
  const bullets = project.bullets.map(parseBullet);
  const hasMore = bullets.length > visibleCount;
  const [revealed, setRevealed] = useState(alwaysRevealed);

  return (
    <div
      className="group/card rounded-xl border border-border bg-card p-4 sm:p-6 transition-all duration-300 hover:border-foreground/20"
      onMouseEnter={() => { if (!isMobile && hasMore && !revealed) setRevealed(true); }}
    >
      <div className="flex items-center justify-between">
        {project.live ? (
          <a href={project.live} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold group-hover/card:text-foreground transition-colors hover:underline underline-offset-4">
            {project.title}
          </a>
        ) : (
          <h3 className="text-lg font-semibold group-hover/card:text-foreground transition-colors">
            {project.title}
          </h3>
        )}
        <div className="flex items-center gap-3">
          {project.live && (
            <a href={project.live} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-foreground transition-colors" title="Live Demo">
              <ExternalLinkIcon className="size-5" />
            </a>
          )}
          {project.github && (
            <a href={project.github} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-foreground transition-colors" title="Source Code">
              <GithubIcon className="size-5" />
            </a>
          )}
        </div>
      </div>

      <p className="mt-2 text-secondary text-sm">{project.summary}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {project.technologies.map((tech) => {
          const icon = skillIconMap[tech.iconKey] || skillIconMap[tech.name];
          return (
            <div key={tech.name} className="group/tech relative flex items-center">
              <div className="size-8 rounded-lg border border-border bg-muted p-1.5 transition-all duration-200 group-hover/tech:scale-110 group-hover/tech:border-foreground/20">
                {icon}
              </div>
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-secondary opacity-0 group-hover/tech:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {tech.name}
              </span>
            </div>
          );
        })}
      </div>

      <ul className="mt-5 space-y-2.5 text-sm leading-relaxed">
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
            <ul className="space-y-2.5 blur-[3px] opacity-50 select-none">
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
          <ul className="space-y-2.5">
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
        <div className="relative mt-1">
          <ul className="space-y-2.5 text-sm leading-relaxed blur-[3px] opacity-50 select-none">
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

function ProjectCardWrapper({ project, alwaysRevealed, animationDelay }: { project: ProjectData; alwaysRevealed?: boolean; animationDelay?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [cardTop, setCardTop] = useState(0);
  const [cardRight, setCardRight] = useState(0);
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const showPreview = () => {
    if (hideTimeout.current) { clearTimeout(hideTimeout.current); hideTimeout.current = null; }
    setHovered(true);
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setCardTop(rect.top + window.scrollY);
      setCardRight(rect.right);
    }
  };

  const scheduleHide = () => {
    hideTimeout.current = setTimeout(() => setHovered(false), 100);
  };

  return (
    <div
      ref={cardRef}
      className={animationDelay ? 'animate-fade-in-blur' : ''}
      style={animationDelay ? { animationDelay } : undefined}
      onMouseEnter={showPreview}
      onMouseLeave={scheduleHide}
    >
      <ProjectCard project={project} alwaysRevealed={alwaysRevealed} />
      {mounted && !isMobile && project.images.length > 0 && createPortal(
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute z-50"
              style={{ top: cardTop, left: cardRight + 16 }}
              onMouseEnter={showPreview}
              onMouseLeave={scheduleHide}
            >
              <ImageCarousel images={project.images} title={project.title} link={project.live ?? project.github ?? '#'} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export default function Projects({ projects }: { projects: ProjectData[] }) {
  const [showAll, setShowAll] = useState(false);

  return (
    <section id="projects">
      <Container className="mt-20 animate-fade-in-blur animate-delay-3">
        <SectionHeading subHeading="Work" heading="Projects" />
        <div className="mt-6 grid gap-6">
          {projects.slice(0, INITIAL_PROJECTS).map((project, i) => (
            <ProjectCardWrapper key={project.title} project={project} alwaysRevealed={i === 0} />
          ))}
          {showAll && projects.slice(INITIAL_PROJECTS).map((project, i) => (
            <ProjectCardWrapper key={project.title} project={project} animationDelay={`${i * 120}ms`} />
          ))}
        </div>
        {!showAll && projects.length > INITIAL_PROJECTS && (
          <button
            onClick={() => setShowAll(true)}
            className="mt-6 mx-auto flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-secondary transition-all duration-200 hover:border-foreground/30 hover:text-foreground cursor-pointer"
          >
            Show More Projects
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        )}
      </Container>
    </section>
  );
}
