'use client';

import { useState } from 'react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { socialIconMap } from '@/lib/icon-map';

interface Purpose {
  label: string;
  emoji: string;
}

interface SocialLink {
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
}

export default function Contact({ purposes, socialLinks, contactEmail, availabilityStatus, availabilityDetail }: ContactProps) {
  const [form, setForm] = useState({ name: '', email: '', purpose: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSubmitted(true);
        setForm({ name: '', email: '', purpose: '', message: '' });
        setTimeout(() => setSubmitted(false), 3000);
      }
    } catch {
      // fallback to mailto
      const subject = form.purpose
        ? `[${form.purpose}] Contact from ${form.name}`
        : `Portfolio Contact from ${form.name}`;
      const mailtoLink = `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(form.message)}%0A%0AFrom: ${encodeURIComponent(form.name)} (${encodeURIComponent(form.email)})`;
      window.open(mailtoLink, '_blank');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="contact">
      <Container className="mt-20 animate-fade-in-blur animate-delay-5">
        <SectionHeading subHeading="Let's Connect" heading="Get in Touch" />

        <div className="mt-8 grid gap-8 md:gap-10 md:grid-cols-5">
          <form onSubmit={handleSubmit} className="space-y-5 md:col-span-3">
            <div>
              <span className="block text-xs font-medium text-secondary mb-2.5 uppercase tracking-wider">What&apos;s this about?</span>
              <div className="flex flex-wrap gap-2">
                {purposes.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, purpose: prev.purpose === p.label ? '' : p.label }))}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200 cursor-pointer ${
                      form.purpose === p.label
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-card text-secondary hover:border-foreground/30 hover:text-foreground'
                    }`}
                  >
                    <span className="mr-1">{p.emoji}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10 transition-all placeholder:text-muted-foreground/50"
                placeholder="Your name"
              />
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10 transition-all placeholder:text-muted-foreground/50"
                placeholder="you@example.com"
              />
            </div>

            <textarea
              required
              rows={4}
              value={form.message}
              onChange={(e) => setForm(prev => ({ ...prev, message: e.target.value }))}
              className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-foreground/30 focus:ring-1 focus:ring-foreground/10 transition-all resize-none placeholder:text-muted-foreground/50"
              placeholder="Tell me about your project or idea..."
            />

            <button
              type="submit"
              disabled={sending}
              className="group inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90 cursor-pointer ml-auto disabled:opacity-60"
            >
              {submitted ? (
                <>
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Sent!
                </>
              ) : sending ? (
                <>
                  <div className="size-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <svg className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Send Message
                </>
              )}
            </button>
          </form>

          <div className="md:col-span-2 space-y-2">
            <div className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5">
              <span className="relative flex size-5 items-center justify-center">
                <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{availabilityStatus}</span>
                <span className="text-xs text-secondary">{availabilityDetail}</span>
              </div>
            </div>

            {socialLinks.map((link) => {
              const IconFn = socialIconMap[link.iconKey];
              return (
                <a
                  key={link.name}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-all duration-200 hover:border-border hover:bg-card"
                >
                  <span className="text-secondary group-hover:text-foreground transition-colors">
                    {IconFn && IconFn({ className: 'size-5' })}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium group-hover:text-foreground transition-colors">{link.name}</span>
                    {link.detail && <span className="text-xs text-secondary">{link.detail}</span>}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
