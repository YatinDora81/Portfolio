'use client';

import { useEffect, useState } from 'react';
import Container from '../common/Container';
import { skillIconMap, socialIconMap } from '@/lib/icon-map';

interface HeroProps {
  titles: string[];
  skills: { name: string; iconKey: string }[];
  socialLinks: { name: string; href: string; iconKey: string }[];
  name: string;
  tagline: string;
  intro: string;
  avatarUrl: string;
  resumeUrl: string;
}

function RotatingTitle({ titles }: { titles: string[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % titles.length);
        setIsVisible(true);
      }, 400);
    }, 2500);
    return () => clearInterval(interval);
  }, [titles.length]);

  return (
    <span
      className={`title-gradient transition-all duration-400 ease-in-out ${
        isVisible
          ? 'opacity-100 blur-0 translate-y-0'
          : 'opacity-0 blur-[6px] -translate-y-2'
      }`}
      style={{ display: 'inline-block' }}
    >
      {titles[currentIndex]}
    </span>
  );
}

export default function Hero({ titles, skills, socialLinks, name, tagline, intro, avatarUrl, resumeUrl }: HeroProps) {
  return (
    <Container className="pt-28 pb-12 animate-fade-in-blur">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarUrl}
        alt={name}
        className="size-24 rounded-full object-cover ring-2 ring-border ring-offset-2 ring-offset-background"
      />

      <div className="mt-8 flex flex-col gap-3">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-snug">
          {`Hi, I'm ${name} — `}
          <RotatingTitle titles={titles} />
          <span className="text-secondary">.</span>
        </h1>

        <p className="mt-2 text-base text-secondary md:text-lg leading-loose">
          {intro}{' '}
          {skills.map((skill, i) => (
            <span key={skill.name}>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted px-2.5 h-7 text-sm text-foreground font-medium align-middle">
                <span className="size-4 shrink-0">{skillIconMap[skill.iconKey]}</span>
                {skill.name}
              </span>
              {i < skills.length - 2 && ' '}
              {i === skills.length - 2 && ' and '}
            </span>
          ))}
          {`. ${tagline}`}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={resumeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-muted"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Resume / CV
        </a>
        <a
          href="#contact"
          className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Get in touch
        </a>
      </div>

      <div className="mt-8 flex gap-3">
        {socialLinks.map((link) => {
          const IconFn = socialIconMap[link.iconKey];
          return (
            <a
              key={link.name}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary hover:text-foreground transition-colors duration-200"
              title={link.name}
            >
              {IconFn && IconFn({})}
            </a>
          );
        })}
      </div>
    </Container>
  );
}
