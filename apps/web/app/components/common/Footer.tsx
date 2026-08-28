'use client';

/**
 * Footer v6.1 — "the finale", responsive wordmark
 *
 * Desktop (lg+): full name — YATIN DORA. Tablet/mobile: YATIN.
 * Font size auto-scales to the text length so the full name keeps natural
 * letter proportions while still spanning edge-to-edge.
 *
 * Three layers on the name: gradient melt, sheen sweep (~7s), and a pointer
 * spotlight that works with mouse AND touch. Click/tap → back to top.
 * Above it: breathing ✦ divider + editorial mono copyright. Socials live in
 * Let's Connect only.
 *
 * Optional prop: wordmark — overrides the desktop text; mobile uses its first word.
 */

import { useEffect, useRef } from 'react';
import Container from './Container';

interface SocialLink {
  name: string;
  href: string;
  iconKey: string;
  detail: string | null;
}

function NameMark({
  text,
  gradientId,
  className,
}: {
  text: string;
  gradientId: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // The sheen sweeps `mask-position` and cannot run on the compositor, so
  // while it is animating the main thread paints a frame every 16ms — and it
  // used to do that from page load, for a wordmark five screens below the
  // fold. It is paused (see `.yfw-wrap.in` below) until the footer is actually
  // near the viewport, then runs exactly as before.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => el.classList.toggle('in', entries.some((e) => e.isIntersecting)),
      { rootMargin: '200px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Auto-size: longer text → smaller font so glyphs keep natural
  // proportions while textLength stretches them edge-to-edge.
  const effLen = [...text].reduce((a, ch) => a + (ch === ' ' ? 0.5 : 1), 0);
  const fs = Math.max(54, Math.min(100, Math.round(665 / Math.max(effLen, 1))));
  const capH = fs * 0.727;
  const y = Math.round(5 + capH);
  const vbH = Math.round(5 + capH * 0.77); // bottom crop — 77% of cap height visible

  const textProps = {
    x: 200,
    y,
    textAnchor: 'middle',
    textLength: 392,
    lengthAdjust: 'spacingAndGlyphs',
    fontSize: fs,
    fontWeight: 900,
    letterSpacing: '-0.02em',
  } as const;

  const onPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-label="Back to top"
      title="back to top"
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onClick={toTop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toTop();
        }
      }}
      className={[
        'yfw-wrap relative mt-8 w-full cursor-pointer select-none text-foreground',
        // `ring-inset`: the footer sets `overflow-hidden` for the sheen mask,
        // and an outset ring on this full-width last child is clipped on three
        // sides by it — only the top 2px survived.
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/70',
        className ?? '',
      ].join(' ')}
      style={{ touchAction: 'pan-y' }}
    >
      <svg
        viewBox={`0 0 400 ${vbH}`}
        className="block w-full"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="0.55" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <text {...textProps} fill={`url(#${gradientId})`}>
          {text}
        </text>
      </svg>

      <svg
        viewBox={`0 0 400 ${vbH}`}
        className="yfw-sheen pointer-events-none absolute inset-0 block h-full w-full"
        role="presentation"
        focusable="false"
      >
        <text {...textProps} fill="currentColor" opacity="0.35">
          {text}
        </text>
      </svg>

      <svg
        viewBox={`0 0 400 ${vbH}`}
        className="yfw-reveal pointer-events-none absolute inset-0 block h-full w-full"
        role="presentation"
        focusable="false"
      >
        <text {...textProps} fill="currentColor" opacity="0.9">
          {text}
        </text>
      </svg>
    </div>
  );
}

export default function Footer({
  copyrightName,
  wordmark,
}: {
  socialLinks?: SocialLink[];
  copyrightName: string;
  wordmark?: string;
}) {
  const fullText = (wordmark || copyrightName.trim() || 'PORTFOLIO')
    .trim()
    .toUpperCase();
  const shortText = fullText.split(/\s+/)[0] ?? fullText;

  return (
    <footer
      className="overflow-hidden pt-24"
      style={{
        backgroundImage:
          'linear-gradient(to bottom, transparent 0px, var(--background) 210px)',
      }}
    >
      <style>{`
        .yfw-reveal {
          opacity: 0;
          transition: opacity .35s ease;
          -webkit-mask-image: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), #000 25%, transparent 70%);
          mask-image: radial-gradient(220px circle at var(--mx, 50%) var(--my, 50%), #000 25%, transparent 70%);
        }
        .yfw-wrap:hover .yfw-reveal, .yfw-wrap:active .yfw-reveal { opacity: 1; }
        .yfw-sheen {
          opacity: 1;
          transition: opacity .4s ease;
          -webkit-mask-image: linear-gradient(100deg, transparent 32%, #000 50%, transparent 68%);
          mask-image: linear-gradient(100deg, transparent 32%, #000 50%, transparent 68%);
          -webkit-mask-size: 250% 100%;
          mask-size: 250% 100%;
          animation: yfw-sheen 7s ease-in-out infinite;
          animation-play-state: paused;
        }
        .yfw-wrap.in .yfw-sheen { animation-play-state: running; }
        .yfw-wrap:hover .yfw-sheen { opacity: 0; }
        @keyframes yfw-sheen {
          0% { -webkit-mask-position: 140% 0; mask-position: 140% 0; }
          45%, 100% { -webkit-mask-position: -40% 0; mask-position: -40% 0; }
        }
        .yfw-star { animation: yfw-star 3.2s ease-in-out infinite; animation-play-state: paused; }
        .yfw-wrap.in .yfw-star { animation-play-state: running; }
        @keyframes yfw-star {
          0%, 100% { opacity: .35; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .yfw-sheen { animation: none; opacity: 0; }
          .yfw-star { animation: none; opacity: .6; }
        }
      `}</style>

      <Container className="pt-10">
        {/* breathing ✦ divider */}
        <div
          aria-hidden
          className="flex items-center gap-3 text-[10px] text-secondary"
        >
          <span className="h-px flex-1 bg-border" />
          <span className="yfw-star">&#10022;</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* editorial mono copyright */}
        <p className="mt-7 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-secondary">
          &copy; {new Date().getFullYear()} {copyrightName} &mdash; all rights
          reserved
        </p>
      </Container>

      {/* THE NAME — full name on desktop, first name on tablet/mobile */}
      <NameMark
        text={fullText}
        gradientId="yfw-fade-lg"
        className="hidden lg:block"
      />
      <NameMark
        text={shortText}
        gradientId="yfw-fade-sm"
        className="lg:hidden"
      />
    </footer>
  );
}
