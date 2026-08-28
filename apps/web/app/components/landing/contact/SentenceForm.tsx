'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from 'react';
import { useReducedMotion } from 'motion/react';
import type { Purpose } from '../Contact';
import type { ScopeHandle } from './Scope';

interface ComposerProps {
  purposes: Purpose[];
  contactEmail: string;
  note: string;
  scope: RefObject<ScopeHandle | null>;
  turnstileSiteKey: string | null;
}

interface SentenceFormProps extends ComposerProps {
  enabled: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 1000;
const MIN_MESSAGE = 10;
const NEAR = 900;

const PH_NAME = 'your name';
const PH_EMAIL = 'you@company.com';
const PH_MSG = 'here’s what’s on my mind…';

const HONEYPOT_FIELD = 'company_website';
const FORM_TOKEN_FIELD = 'form_token';

const HONEYPOT: CSSProperties = { position: 'absolute', left: '-9999px', top: 0 };

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

declare global {
  interface Window {
    turnstile?: { reset: (container?: Element) => void };
  }
}

const FLOOR_MS = 950;

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function stamp() {
  const now = new Date();
  const hm = { hour12: false, hour: '2-digit', minute: '2-digit' } as const;
  try {
    return `${now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', ...hm })} IST`;
  } catch {
    return now.toLocaleTimeString('en-GB', hm);
  }
}

function fitBlank(blank: HTMLElement | null) {
  const input = blank?.querySelector('input');
  const mirror = blank?.querySelector<HTMLElement>('.mirror');
  const line = blank?.parentElement;
  if (!input || !mirror || !line?.clientWidth) return;
  mirror.textContent = input.value || input.placeholder;
  input.style.width = `${Math.min(mirror.offsetWidth + 6, line.clientWidth - 20)}px`;
}

function grow(ta: HTMLTextAreaElement | null) {
  if (!ta?.clientWidth) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

// reflow between the writes restarts the keyframe
function markErr(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('err');
  void el.offsetWidth;
  el.classList.add('err');
}

function UpArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

interface AckPart {
  text: string;
  cls?: string;
}

type Tail = 'another' | 'mailto' | null;

function Paused({ contactEmail }: { contactEmail: string }) {
  return (
    <div className="sent-form">
      <p className="sentence">
        <b>Hey Yatin</b> &mdash; the form is off the air for a moment.{' '}
        {contactEmail
          ? 'The address just below still reaches me, and it lands in the same inbox.'
          : 'The links just below still reach me.'}
      </p>
      <p className="ack">tx paused · rx open</p>
    </div>
  );
}

export default function SentenceForm({ enabled, ...props }: SentenceFormProps) {
  if (!enabled) return <Paused contactEmail={props.contactEmail} />;
  return <Composer {...props} />;
}

function Composer({
  purposes,
  contactEmail,
  note,
  scope,
  turnstileSiteKey,
}: ComposerProps) {
  const reduced = useReducedMotion();
  const railId = useId();
  const capId = useId();
  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const msgId = `${uid}-message`;
  const hpId = `${uid}-website`;

  const openWith =
    purposes.find((p) => /^just saying hi$/i.test(p.label.trim()))?.label ?? purposes[0]?.label ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [purpose, setPurpose] = useState(openWith);
  const [railOpen, setRailOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [tail, setTail] = useState<Tail>(null);
  const [say, setSay] = useState({ n: 0, text: '' });
  const [sends, setSends] = useState(0);
  const [formToken, setFormToken] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const bNameRef = useRef<HTMLSpanElement>(null);
  const bEmailRef = useRef<HTMLSpanElement>(null);
  const bMsgRef = useRef<HTMLSpanElement>(null);
  const pkRef = useRef<HTMLButtonElement>(null);
  const ackRef = useRef<HTMLSpanElement>(null);
  const typing = useRef<number | null>(null);
  const hpRef = useRef<HTMLInputElement>(null);

  const refit = useCallback(() => {
    fitBlank(bNameRef.current);
    fitBlank(bEmailRef.current);
    grow(msgRef.current);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let live = true;
    let w = 0;

    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next === w) return;
      w = next;
      refit();
    });
    ro.observe(form);

    const onResize = () => refit();
    window.addEventListener('resize', onResize, { passive: true });
    document.fonts?.ready.then(() => {
      if (live) refit();
    });
    refit();

    return () => {
      live = false;
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [refit]);

  useEffect(() => {
    if (sends) refit();
  }, [sends, refit]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/contact/token', { signal: ac.signal });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (body && typeof body === 'object' && 'token' in body && typeof body.token === 'string') {
          setFormToken(body.token);
        }
      } catch {
        // no token; the form still submits without one
      }
    })();
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    const form = formRef.current;
    if (!form) return;

    let loaded = false;
    const load = () => {
      if (loaded) return;
      loaded = true;
      if (document.querySelector(`script[src="${TURNSTILE_SRC}"]`)) return;
      const s = document.createElement('script');
      s.src = TURNSTILE_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    };

    const target = form.closest('section') ?? form;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          load();
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(target);
    form.addEventListener('focusin', load, { once: true });

    return () => {
      io.disconnect();
      form.removeEventListener('focusin', load);
    };
  }, [turnstileSiteKey]);

  useEffect(
    () => () => {
      if (typing.current !== null) window.clearInterval(typing.current);
    },
    [],
  );

  const typeAck = useCallback(
    (parts: AckPart[], ends: Tail = null) => {
      const host = ackRef.current;
      if (!host) return;
      if (typing.current !== null) window.clearInterval(typing.current);
      setTail(null);
      setSay((s) => ({ n: s.n + 1, text: parts.map((p) => p.text).join('') }));

      host.textContent = '';
      const caret = document.createElement('span');
      caret.className = 'caret';
      host.appendChild(caret);

      let pi = 0;
      let ci = 0;
      let cur: HTMLSpanElement | null = null;
      typing.current = window.setInterval(
        () => {
          const part = parts[pi];
          if (!part) {
            if (typing.current !== null) window.clearInterval(typing.current);
            typing.current = null;
            caret.remove();
            setTail(ends);
            return;
          }
          if (!cur) {
            cur = document.createElement('span');
            if (part.cls) cur.className = part.cls;
            host.insertBefore(cur, caret);
          }
          cur.textContent += part.text[ci++];
          if (ci >= part.text.length) {
            pi++;
            ci = 0;
            cur = null;
          }
        },
        reduced ? 1 : 16,
      );
    },
    [reduced],
  );

  const clearAck = () => {
    if (typing.current !== null) window.clearInterval(typing.current);
    typing.current = null;
    if (ackRef.current) ackRef.current.textContent = '';
    setTail(null);
    setSay((s) => ({ n: s.n + 1, text: '' }));
  };

  const openMailtoFallback = () => {
    const subject = purpose
      ? `[${purpose}] Contact from ${name}`
      : `Portfolio Contact from ${name}`;
    const body = `${message}\n\nFrom: ${name} (${email})`;
    window.open(
      `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      '_blank',
    );
  };

  const pickPurpose = (label: string) => {
    setPurpose(label);
    setRailOpen(false);
    pkRef.current?.focus();
    scope.current?.poke(0.3);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;

    const okName = name.trim().length > 0;
    const okEmail = EMAIL_RE.test(email.trim());
    const okMsg = message.trim().length >= MIN_MESSAGE;
    if (!okName || !okEmail || !okMsg) {
      if (!okName) markErr(bNameRef.current);
      if (!okEmail) markErr(bEmailRef.current);
      if (!okMsg) markErr(bMsgRef.current);
      (!okName ? nameRef : !okEmail ? emailRef : msgRef).current?.focus();
      typeAck([
        { text: 'err — ' },
        {
          text: !okName
            ? 'the line needs a name. '
            : !okEmail
              ? 'that email doesn’t parse. '
              : `a few more words (${MIN_MESSAGE}+). `,
        },
      ]);
      return;
    }

    setSending(true);
    clearAck();
    scope.current?.burst();

    const payload = {
      name: name.trim(),
      email: email.trim(),
      purpose,
      message: message.trim(),
      turnstileToken:
        formRef.current?.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value ??
        '',
      [HONEYPOT_FIELD]: hpRef.current?.value ?? '',
      ...(formToken ? { [FORM_TOKEN_FIELD]: formToken } : {}),
    };

    const started = Date.now();
    const settle = async () => {
      if (reduced) return;
      await wait(Math.max(0, FLOOR_MS - (Date.now() - started)));
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const widget = formRef.current?.querySelector('.cf-turnstile');
      if (widget) window.turnstile?.reset(widget);
      await settle();
      if (res.ok) {
        setName('');
        setEmail('');
        setMessage('');
        setPurpose(openWith);
        setSends((s) => s + 1);
        typeAck(
          [
            { text: 'ACK 202 ', cls: 'ok' },
            { text: `· transmission received · ${stamp()}\n` },
            {
              text: payload.purpose
                ? `re: ${payload.purpose} · reply lands at ${payload.email} within 24h  `
                : `reply lands at ${payload.email} within 24h  `,
            },
          ],
          'another',
        );
      } else {
        let said = '';
        try {
          const body: unknown = await res.json();
          if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
            said = body.error.trim();
          }
        } catch {
          // non-json body falls through to the line below
        }
        typeAck(
          [
            { text: 'err — ' },
            { text: said ? `${said} ` : 'that didn’t land. nothing was lost — transmit again, or ' },
          ],
          'mailto',
        );
      }
    } catch {
      openMailtoFallback();
      await settle();
      typeAck([
        { text: 'err — ' },
        { text: 'the network dropped it. your mail app has a copy; the words are still here. ' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const count = message.length;

  return (
    <form
      className="sent-form"
      id="ctForm"
      ref={formRef}
      onSubmit={submit}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Escape' && railOpen) {
          setRailOpen(false);
          pkRef.current?.focus();
        }
      }}
    >
      <p className="sentence">
        <b>Hey Yatin</b> &mdash; I&rsquo;m{' '}
        <span className="blank" ref={bNameRef}>
          <label htmlFor={nameId} className="sr-only">
            Your name
          </label>
          <input
            id={nameId}
            ref={nameRef}
            name="name"
            type="text"
            autoComplete="name"
            maxLength={MAX_NAME}
            placeholder={PH_NAME}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              fitBlank(bNameRef.current);
              bNameRef.current?.classList.remove('err');
              scope.current?.poke(0.2);
            }}
            onFocus={() => scope.current?.poke(0.12)}
          />

          <span className="mirror" aria-hidden="true" />
        </span>
        {purposes.length > 0 && (
          <>
            , reaching out about{' '}
            <button
              type="button"
              className="pk"
              ref={pkRef}
              aria-expanded={railOpen}
              aria-controls={railId}
              onClick={() => setRailOpen((o) => !o)}
            >
              <span>{purpose}</span>
              <span className="car" aria-hidden="true">
                ▾
              </span>
            </button>
          </>
        )}
        .{' '}
        <span className="msg-line" ref={bMsgRef}>
          <label htmlFor={msgId} className="sr-only">
            Your message
          </label>
          <textarea
            id={msgId}
            ref={msgRef}
            name="message"
            rows={1}
            maxLength={MAX_MESSAGE}
            placeholder={PH_MSG}
            aria-describedby={capId}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              grow(msgRef.current);
              bMsgRef.current?.classList.remove('err');
              scope.current?.poke(0.2);
            }}
            onFocus={() => scope.current?.poke(0.12)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
        </span>{' '}
        You can reach me back at{' '}
        <span className="blank" ref={bEmailRef}>
          <label htmlFor={emailId} className="sr-only">
            Your email address
          </label>
          <input
            id={emailId}
            ref={emailRef}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={MAX_EMAIL}
            placeholder={PH_EMAIL}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              fitBlank(bEmailRef.current);
              bEmailRef.current?.classList.remove('err');
              scope.current?.poke(0.2);
            }}
            onFocus={() => scope.current?.poke(0.12)}
          />
          <span className="mirror" aria-hidden="true" />
        </span>
        .
      </p>
      <span id={capId} className="sr-only">
        Up to {MAX_MESSAGE} characters.
      </span>

      <div style={HONEYPOT} aria-hidden="true">
        <label htmlFor={hpId}>Company website</label>
        <input id={hpId} ref={hpRef} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {formToken && <input type="hidden" name={FORM_TOKEN_FIELD} value={formToken} readOnly />}

      {purposes.length > 0 && (
        <div className={`chip-rail${railOpen ? ' open' : ''}`} id={railId}>

          <div role="group" aria-label="Reason for reaching out" inert={!railOpen}>
            {purposes.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                aria-pressed={p.label === purpose}
                onClick={() => pickPurpose(p.label)}
              >
                {p.emoji ? `${p.emoji} ${p.label}` : p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {turnstileSiteKey && (
        <div
          className="cf-turnstile"
          data-sitekey={turnstileSiteKey}
          data-theme="auto"
          data-size="flexible"
          style={{ marginTop: 22 }}
        />
      )}

      <div className="tx-row">
        <span className={`f-count mono${count > NEAR ? ' near' : ''}`} aria-hidden="true">
          {count}/{MAX_MESSAGE}
        </span>
        <span className="tx-note">{note}</span>
        <span className="tx-spacer" />

        <button className="tx-btn" type="submit" aria-disabled={sending}>
          <span className="btnwave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>{sending ? 'Transmitting' : 'Transmit'}</span>
          <span className="up" aria-hidden="true">
            {sending ? <span className="spin" /> : <UpArrow />}
          </span>
        </button>
      </div>

      <p className="ack" role="status" aria-live="polite">
        <span ref={ackRef} aria-hidden="true" />
        {say.text ? (
          <span className="sr-only" key={say.n}>
            {say.text}
          </span>
        ) : null}
        {tail === 'another' && (
          <button
            type="button"
            className="again"
            onClick={() => {
              clearAck();
              nameRef.current?.focus();
            }}
          >
            send another
          </button>
        )}
        {tail === 'mailto' && (
          <button type="button" className="again" onClick={openMailtoFallback}>
            email it instead
          </button>
        )}
      </p>
    </form>
  );
}
