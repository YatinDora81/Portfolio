'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import Container from '../common/Container';
import DecodeLabel from '../common/DecodeLabel';
import type { GithubActivity } from '../../lib/github';
import Scope, { type ScopeHandle } from './contact/Scope';
import SentenceForm from './contact/SentenceForm';
import Carrier from './contact/Carrier';
import Frequencies from './contact/Frequencies';

export interface Purpose {
  label: string;
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
  turnstileSiteKey: string | null;
}

function useIstClock(seconds: boolean) {
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
        // some ICU builds render midnight as hour 24
        setAwake(hour >= 8 && hour < 24);
      } catch {
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
  turnstileSiteKey,
}: ContactProps) {
  const reduced = useReducedMotion();
  const { time, awake } = useIstClock(!reduced);

  // content-visibility:auto on #contact hides its subtree from the observer
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: true, amount: 0.08 });

  const scope = useRef<ScopeHandle>(null);

  return (
    <section id="contact" ref={sectionRef}>
      <Container className="mt-20 animate-fade-in-blur animate-delay-5">
        <div className={`ct${inView ? ' in' : ''}`}>
          <div className="rv" style={rise('0s')}>
            <div className="lab">
              <DecodeLabel text="contact — ch.06" />
              <i aria-hidden="true" />
            </div>
            <div className="ct-head">
              <h2 className="ct-title">Open a channel.</h2>
              <span className="ct-now mono">
                <span className="sig-dot" aria-hidden="true" />
                <span className="sr-only">Local time in Bengaluru: </span>
                <time className="ct-clock">{time}</time>
                <span>IST</span>
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
              turnstileSiteKey={turnstileSiteKey}
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
