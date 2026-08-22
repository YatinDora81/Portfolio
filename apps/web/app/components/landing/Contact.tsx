'use client';

/**
 * Contact — the composition root and nothing else.
 *
 * Every moving part lives in ./contact/*, so a keystroke re-renders one field
 * rather than the instrument above it, and the wave is driven through an
 * imperative handle rather than props — poking it from state would re-render
 * the section at typing speed.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import Container from '../common/Container';
import type { GithubActivity } from '../../lib/github';
import Scope, { type ScopeHandle } from './contact/Scope';
import SentenceForm from './contact/SentenceForm';
import Carrier from './contact/Carrier';
import Frequencies from './contact/Frequencies';

export interface Purpose {
  label: string;
  /** Drawn as the chip's icon. The only colour the section carries. */
  emoji: string;
}

export interface SocialLink {
  name: string;
  href: string;
  iconKey: string;
  detail: string | null;
}

interface ContactProps {
  purposes: Purpose[];
  socialLinks: SocialLink[];
  contactEmail: string;
  availabilityStatus: string;
  availabilityDetail: string;
  resumeUrl: string;
  github: GithubActivity | null;
  formEnabled: boolean;
}

/** IST wall clock, and whether that hour is a plausible one to get a reply.
    `seconds` is false under reduced motion — a second hand is motion. */
function useIstClock(seconds: boolean) {
  // A placeholder, because formatting the visitor's clock during SSR guarantees
  // a mismatch. The literal does NOT vary with `seconds`: that comes from
  // useReducedMotion(), which is null on the server and the real value on the
  // client's first render, so branching here mismatched too.
  const [time, setTime] = useState('--:--:--');
  const [awake, setAwake] = useState<boolean | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      try {
        setTime(
          now.toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: false,
            ...(seconds ? {} : { hour: '2-digit', minute: '2-digit' }),
          }),
        );
        const hour = parseInt(
          now.toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour12: false,
            hour: '2-digit',
          }),
          10,
        );
        // `< 24` is not redundant: some ICU builds render midnight as hour 24.
        setAwake(hour >= 8 && hour < 24);
      } catch {
        // A runtime without the IANA database still gets a ticking clock.
        setTime(now.toLocaleTimeString('en-GB', { hour12: false }));
        setAwake(null);
      }
    };
    tick();
    const id = window.setInterval(tick, seconds ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [seconds]);

  return { time, awake };
}

/** The entrance stagger, kept in the parent so the children stay ignorant of the
    cascade: each block is wrapped rather than asked to carry its own delay. */
const rise = (d: string) => ({ '--d': d }) as CSSProperties;

export default function Contact({
  purposes,
  socialLinks,
  contactEmail,
  availabilityStatus,
  availabilityDetail,
  resumeUrl,
  github,
  formEnabled,
}: ContactProps) {
  const reduced = useReducedMotion();
  const { time, awake } = useIstClock(!reduced);

  // Observed on the SECTION, not `.ct`: `#contact` carries
  // content-visibility:auto, and a container skipping its contents suppresses
  // IntersectionObserver for everything beneath it.
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.08 });

  const scope = useRef<ScopeHandle>(null);

  return (
    <section id="contact" ref={sectionRef}>
      <Container className="mt-20 animate-fade-in-blur animate-delay-5">
        <div className={`ct${inView ? ' in' : ''}`}>
          <div className="rv" style={rise('0s')}>
            <div className="lab">
              <span>contact — ch.01</span>
              <i aria-hidden="true" />
            </div>
            <div className="ct-head">
              <h2 className="ct-title">Open a channel.</h2>
              <span className="ct-now mono">
                <span className="sig-dot" aria-hidden="true" />
                <span className="sr-only">Local time in Bengaluru: </span>
                <time className="ct-clock">{time}</time>
                <span>IST</span>
                {/* The cat's entire budget in this section. */}
                <span className="awk">· {awake === false ? 'sleeping =^..^=' : 'online'}</span>
              </span>
            </div>
          </div>

          <div className="rv" style={rise('.08s')}>
            <Scope
              ref={scope}
              caption={
                availabilityStatus ||
                (formEnabled ? 'type below — the line listens' : 'receiving only — transmit paused')
              }
            />
          </div>

          <div className="rv" style={rise('.16s')}>
            <SentenceForm
              enabled={formEnabled}
              purposes={purposes}
              contactEmail={contactEmail}
              note={availabilityDetail || '↪ straight to my inbox · reply < 24h'}
              scope={scope}
            />
          </div>

          <div className="rv" style={rise('.24s')}>
            <Carrier email={contactEmail} scope={scope} />
          </div>

          <div className="rv" style={rise('.32s')}>
            <Frequencies socialLinks={socialLinks} resumeUrl={resumeUrl} github={github} />
          </div>

          <div className="ct-close rv" style={rise('.4s')}>
            <span>end of transmission</span>
            <span className="coord">12.97°N 77.59°E · <span className="loc-city">Bengaluru</span></span>
          </div>
        </div>
      </Container>
    </section>
  );
}
