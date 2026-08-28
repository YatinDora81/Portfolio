'use client';

// aliased so the peek effect can still reach the DOM's own Image
import NextImage from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { skillIconMap, socialIconMap } from '@repo/ui/icons/registry';
import MagneticLink from '../interactions/MagneticLink';

const PEEK_W = 384; // .peek renders at 164 css px, this covers 2x
const optimized = (src: string, w: number) =>
  `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75`;

type HeroVersion = 'v1' | 'v2';

interface HeroProps {
  version: HeroVersion;
  titles: string[];
  skills: { name: string; iconKey: string }[];
  socialLinks: { name: string; href: string; iconKey: string }[];
  name: string;
  tagline: string;
  intro: string;
  avatarUrl: string;
  resumeUrl: string;
  availabilityStatus: string;
  dotColor?: string;
  dotPulse?: boolean;
  totalSkills?: number;
  photos?: string[];
  showAbout: boolean;
  showSkills: boolean;
  showContact: boolean;
}

function ResumeIcon({ fifthLine }: { fifthLine: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      {fifthLine && <polyline points="10 9 9 9 8 9" />}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

interface BodyProps {
  intro: string;
  tagline: string;
  skills: { name: string; iconKey: string }[];
  resumeUrl: string;
  totalSkills?: number;
  showSkills: boolean;
  showContact: boolean;
}

function HeroBodyV1({ intro, tagline, skills, resumeUrl, showContact }: BodyProps) {
  return (
    <>
      <p className="intro animate-fade-in-blur animate-delay-3">
        {intro}{' '}
        {skills.map((skill, i) => (
          <span key={skill.name}>
            <span className="chip">
              <span className="ci">{skillIconMap[skill.iconKey]}</span>
              {skill.name}
            </span>
            {i < skills.length - 2 && ' '}
            {i === skills.length - 2 && ' and '}
          </span>
        ))}
        {`. ${tagline}`}
      </p>

      <div className="actions animate-fade-in-blur animate-delay-4">
        <MagneticLink
          className="btn btn-ghost"
          href={resumeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ResumeIcon fifthLine />
          Resume / CV
        </MagneticLink>
        {showContact && (
          <MagneticLink className="btn btn-solid" href="#contact">
            Get in touch
            <ArrowIcon />
          </MagneticLink>
        )}
      </div>
    </>
  );
}

function HeroBodyV2({
  intro,
  tagline,
  skills,
  resumeUrl,
  totalSkills,
  showSkills,
  showContact,
}: BodyProps) {
  const remaining = (totalSkills ?? 0) - skills.length;

  return (
    <>
      <p className="intro animate-fade-in-blur animate-delay-3">{intro}</p>
      <p className="voice animate-fade-in-blur animate-delay-3">{tagline}</p>

      <div className="heropills animate-fade-in-blur animate-delay-4">
        {skills.map((skill) => (
          <span key={skill.name} className="chip">
            <span className="ci">{skillIconMap[skill.iconKey]}</span>
            {skill.name}
          </span>
        ))}
        {remaining > 0 && showSkills && (
          <a className="chip chip-more mono" href="#skills" aria-label={`+${remaining} more — see all skills`}>
            +{remaining} more ↓
          </a>
        )}
      </div>

      <div className="actions animate-fade-in-blur animate-delay-5">
        {showContact && (
          <MagneticLink className="btn btn-solid" href="#contact">
            Get in touch
            <ArrowIcon />
          </MagneticLink>
        )}
        <MagneticLink
          className="btn btn-ghost"
          href={resumeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ResumeIcon fifthLine={false} />
          View Resume
        </MagneticLink>
      </div>
    </>
  );
}

function Paw() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse cx="5.6" cy="12.3" rx="1.9" ry="2.5" />
      <ellipse cx="9.7" cy="7.8" rx="2" ry="2.7" />
      <ellipse cx="14.3" cy="7.8" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="12.3" rx="1.9" ry="2.5" />
      <path d="M12 12.4c-3.1 0-5.6 2.1-5.6 4.8 0 2 1.7 3.4 3.9 3.4 1 0 1.2-.4 1.7-.4s.7.4 1.7.4c2.2 0 3.9-1.4 3.9-3.4 0-2.7-2.5-4.8-5.5-4.8Z" />
    </svg>
  );
}

function RotatingRole({ titles }: { titles: string[] }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [animate, setAnimate] = useState(false);

  // read the motion preference after mount, or it desyncs from the server html
  useEffect(() => {
    if (titles.length < 2) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAnimate(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [titles.length]);

  useEffect(() => {
    if (!animate) return;
    let swap: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setVisible(false);
      swap = setTimeout(() => {
        setIndex((prev) => (prev + 1) % titles.length);
        setVisible(true);
      }, 400);
    }, 2500);
    return () => {
      clearInterval(interval);
      clearTimeout(swap);
    };
  }, [animate, titles.length]);

  return (
    <span className={`roleword${visible ? '' : ' is-out'}`} aria-hidden="true">
      {titles[index] ?? ''}
    </span>
  );
}

export default function Hero({
  version,
  titles,
  skills,
  socialLinks,
  name,
  tagline,
  intro,
  avatarUrl,
  resumeUrl,
  availabilityStatus,
  dotColor,
  dotPulse = true,
  totalSkills,
  photos,
  showAbout,
  showSkills,
  showContact,
}: HeroProps) {
  const heroRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const peekRef = useRef<HTMLImageElement>(null);

  const deck = photos && photos.length > 0 ? photos : avatarUrl ? [avatarUrl] : [];

  useEffect(() => {
    const hero = heroRef.current;
    const nameEl = nameRef.current;
    const img = peekRef.current;
    if (!hero || !nameEl || !img) return;

    const list = photos && photos.length > 0 ? photos : avatarUrl ? [avatarUrl] : [];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canPeek =
      list.length > 0 &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !reduceMotion;

    document.documentElement.classList.toggle('no-peek', !canPeek);
    if (!canPeek) return;

    list.slice(1).forEach((src) => {
      const pre = new Image();
      pre.src = optimized(src, PEEK_W);
    });

    const SWAP = 150;
    let tx = 0, ty = 0, x = 0, y = 0, s = 0.7;
    let vis = false, idx = 0, trail = 0, px = 0, py = 0;
    let raf: number | null = null;

    const frame = () => {
      x += (tx - x) * 0.16;
      y += (ty - y) * 0.16;
      s += ((vis ? 1 : 0.7) - s) * 0.18;
      const tilt = Math.max(-10, Math.min(10, (tx - x) * 0.12));
      img.style.transform =
        `translate(${x}px,${y}px) translate(-50%,-58%) rotate(${tilt}deg) scale(${s})`;
      raf = vis || Math.abs(tx - x) > 0.4 || s > 0.72 ? requestAnimationFrame(frame) : null;
    };

    const track = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      trail += Math.abs(tx - px) + Math.abs(ty - py);
      px = tx;
      py = ty;
      if (vis && list.length > 1 && trail > SWAP) {
        trail = 0;
        idx = (idx + 1) % list.length;
        img.src = optimized(list[idx] as string, PEEK_W);
        s = Math.max(0.84, s - 0.12);
      }
    };

    const onEnter = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      tx = x = px = e.clientX - r.left;
      ty = y = py = e.clientY - r.top;
      trail = 0;
      vis = true;
      img.classList.add('on');
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      track(e);
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onLeave = () => {
      vis = false;
      img.classList.remove('on');
      if (!raf) raf = requestAnimationFrame(frame);
    };

    nameEl.addEventListener('pointerenter', onEnter);
    nameEl.addEventListener('pointermove', onMove);
    nameEl.addEventListener('pointerleave', onLeave);
    return () => {
      nameEl.removeEventListener('pointerenter', onEnter);
      nameEl.removeEventListener('pointermove', onMove);
      nameEl.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [photos, avatarUrl]);

  return (
    <section className="hero" id="hero" ref={heroRef}>
      <div className="hcontainer">
        <div className="toprow animate-fade-in-blur">
          <span
            className={`avail mono${dotPulse ? '' : ' still'}`}
            style={dotColor ? ({ '--avail-dot': dotColor } as React.CSSProperties) : undefined}
          >
            <i aria-hidden="true" />
            <span>{availabilityStatus}</span>
          </span>
          <div className="topright">
            <div className="socs mono">
              {socialLinks.map((link) => {
                const IconFn = socialIconMap[link.iconKey];
                return (
                  <a
                    key={link.name}
                    className="soc"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.name}
                    aria-label={link.name}
                  >
                    {IconFn && IconFn({ className: '' })}
                    <span className="lbl">{link.name.toLowerCase()}</span>
                  </a>
                );
              })}
            </div>
            <span className="loc-line mono">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>Based in&nbsp;</span>
              <span className="loc-city">Bengaluru, India</span>
            </span>
          </div>
        </div>

        <div className="peek-stack animate-fade-in-blur animate-delay-1" aria-hidden="true">
          {deck.slice(0, 3).map((src) => (
            <NextImage key={src} src={src} alt="" width={86} height={104} loading="lazy" />
          ))}
        </div>

        <div className="namewrap animate-fade-in-blur animate-delay-1">
          <h1 ref={nameRef}>
            {name.trim().split(/\s+/).join(' ')}
            <span className="dot">.</span>
          </h1>
        </div>

        <p className="roleline mono animate-fade-in-blur animate-delay-2">
          <span className="slash" aria-hidden="true">
            {'//'}
          </span>
          <RotatingRole titles={titles} />
          <span className="caret" aria-hidden="true" />
          <span className="peek-hint" aria-hidden="true">
            &larr; hover my name
          </span>
        </p>
        <span
          className="sr-only"
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
        >
          {titles.join(', ')}
        </span>

        {version === 'v1' ? (
          <HeroBodyV1
            intro={intro}
            tagline={tagline}
            skills={skills}
            resumeUrl={resumeUrl}
            showSkills={showSkills}
            showContact={showContact}
          />
        ) : (
          <HeroBodyV2
            intro={intro}
            tagline={tagline}
            skills={skills}
            resumeUrl={resumeUrl}
            totalSkills={totalSkills}
            showSkills={showSkills}
            showContact={showContact}
          />
        )}
      </div>

      {deck.length > 0 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={peekRef}
          className="peek"
          src={optimized(deck[0] as string, PEEK_W)}
          alt=""
          width={164}
          height={205}
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      )}

      {showAbout && (
        <a className="cue" href="#about" aria-label="Scroll down — more below">
          <i>
            <Paw />
          </i>
          <i>
            <Paw />
          </i>
          <i>
            <Paw />
          </i>
        </a>
      )}
    </section>
  );
}
