'use client';

/**
 * The sentence — the form written as one line of prose you finish rather than a
 * stack of labelled boxes. The fields have no labels because the sentence around
 * them is the label, and each blank is sized to what has been typed into it, so
 * the paragraph reflows as it is filled in.
 *
 * Every keystroke also feeds the instrument above: the scope is driven through
 * its imperative handle, never through props, because a wave that re-rendered
 * this form at typing speed would cost a re-render per character in both
 * directions. The receipt is typed into the DOM for the same reason — a hundred
 * characters is a hundred commits if the string lives in state.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { useReducedMotion } from 'motion/react';
import type { Purpose } from '../Contact';
import type { ScopeHandle } from './Scope';

interface SentenceFormProps {
  purposes: Purpose[];
  contactEmail: string;
  /** The line beside the button — the CMS's availability detail when it has one. */
  note: string;
  scope: RefObject<ScopeHandle | null>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Mirrors the server caps in app/api/contact/route.ts, so an over-long name is
    stopped in the field instead of coming back as a generic 400. */
const MAX_NAME = 100;
const MAX_EMAIL = 254;
/** Deliberately far under the server's 5000: the count in the transmit row and
    its warning threshold are one design with this number, and five thousand
    characters is not a sentence. */
const MAX_MESSAGE = 1000;
const MIN_MESSAGE = 10;
const NEAR = 900;

// Expressions, not JSX string attributes: the mirror measures `input.placeholder`
// and has to be handed the same glyphs the field shows.
const PH_NAME = 'your name';
const PH_EMAIL = 'you@company.com';
const PH_MSG = 'here’s what’s on my mind…';

/** The receipt cannot start typing while the scope is still throwing the message
    out — chaos runs to 0.32s and the flatline to 0.55s. A fetch that resolves
    faster than the instrument waits for it. */
const FLOOR_MS = 950;

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** HH:MM in IST. A runtime without the IANA database drops to the local clock —
    and drops the label with it, because stamping "IST" on a local time is a lie. */
function stamp() {
  const now = new Date();
  const hm = { hour12: false, hour: '2-digit', minute: '2-digit' } as const;
  try {
    return `${now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', ...hm })} IST`;
  } catch {
    return now.toLocaleTimeString('en-GB', hm);
  }
}

/** Sizes a blank to its own contents through the hidden mirror beside it, clamped
    to the line it sits on so a long address cannot push the sentence off screen. */
function fitBlank(blank: HTMLElement | null) {
  const input = blank?.querySelector('input');
  const mirror = blank?.querySelector<HTMLElement>('.mirror');
  const line = blank?.parentElement;
  // A section under content-visibility:auto measures 0 until it renders; sizing
  // to that would collapse every blank to nothing.
  if (!input || !mirror || !line?.clientWidth) return;
  mirror.textContent = input.value || input.placeholder;
  input.style.width = `${Math.min(mirror.offsetWidth + 6, line.clientWidth - 20)}px`;
}

function grow(ta: HTMLTextAreaElement | null) {
  if (!ta?.clientWidth) return;
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

/** Re-adding the class alone never restarts a running keyframe — the element has
    to be laid out again between the two writes. */
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

/** What the receipt offers once it has finished typing. */
type Tail = 'another' | 'mailto' | null;

export default function SentenceForm({ purposes, contactEmail, note, scope }: SentenceFormProps) {
  const reduced = useReducedMotion();
  const railId = useId();
  const capId = useId();

  // Matched against the CMS rather than hardcoded, so a renamed row cannot post
  // a label the server will refuse to match. The sentence has no grammatical
  // room for "no particular reason", so with that row gone it opens on whatever
  // the CMS lists first instead of on an empty word.
  const openWith =
    purposes.find((p) => /^just saying hi$/i.test(p.label.trim()))?.label ?? purposes[0]?.label ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [purpose, setPurpose] = useState(openWith);
  const [railOpen, setRailOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [tail, setTail] = useState<Tail>(null);
  // Re-keyed rather than re-assigned below: two identical errors in a row leave
  // the string unchanged, and a live region that does not mutate does not speak.
  const [say, setSay] = useState({ n: 0, text: '' });
  /** Bumped on a successful send — the fields are cleared through state, so the
      blanks can only be re-measured on the commit after it. */
  const [sends, setSends] = useState(0);

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

    // An observer rather than a mount-time read: the first honest width of a
    // section that is skipping its contents arrives when it starts rendering,
    // which is neither mount nor a window resize. Width only — the textarea
    // grows into this same box, and refitting on height would feed the observer
    // its own output.
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next === w) return;
      w = next;
      refit();
    });
    ro.observe(form);

    const onResize = () => refit();
    window.addEventListener('resize', onResize, { passive: true });
    // A webfont landing after first paint invalidates every width measured
    // against the fallback.
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

  useEffect(
    () => () => {
      if (typing.current !== null) window.clearInterval(typing.current);
    },
    [],
  );

  /** Types the receipt character by character behind a blinking caret. The parts
      carry their own classes, so "ACK 202" can land green while the rest of the
      line stays dim. */
  const typeAck = useCallback(
    (parts: AckPart[], ends: Tail = null) => {
      const host = ackRef.current;
      if (!host) return;
      if (typing.current !== null) window.clearInterval(typing.current);
      setTail(null);
      // Announced whole and at once: a reader should not have to sit through the
      // typing to hear whether the message went.
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
    // The rail is a disclosure: closing it with focus still inside would drop
    // the caret onto a button that is no longer visible.
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

    // Built field by field rather than stringifying state, so renaming anything
    // here cannot silently change the wire format. `purpose` is the CMS label
    // verbatim — the server matches contactPurpose on it and stores NULL for
    // anything it does not recognise, with a 200 either way.
    const payload = {
      name: name.trim(),
      email: email.trim(),
      purpose,
      message: message.trim(),
    };

    const started = Date.now();
    const settle = async () => {
      if (reduced) return; // no wave to wait for
      await wait(Math.max(0, FLOOR_MS - (Date.now() - started)));
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
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
              // Read off the payload, not off state — the fields above have just
              // been cleared and the receipt would otherwise be blank.
              text: payload.purpose
                ? `re: ${payload.purpose} · reply lands at ${payload.email} within 24h  `
                : `reply lands at ${payload.email} within 24h  `,
            },
          ],
          'another',
        );
      } else {
        // fetch RESOLVES on 4xx/5xx — the catch below never sees a rejected
        // message, so without this branch the send fails in total silence. The
        // fields keep everything that was written, and the receipt says so.
        typeAck(
          [
            { text: 'err — ' },
            { text: 'that didn’t land. nothing was lost — transmit again, or ' },
          ],
          'mailto',
        );
      }
    } catch {
      // Network-level: the request never left the browser. Hand the visitor
      // their mail client with the message already in it, and do not clear a
      // thing — nothing has been received and the receipt must not pretend it has.
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
          <input
            ref={nameRef}
            name="name"
            type="text"
            autoComplete="name"
            maxLength={MAX_NAME}
            placeholder={PH_NAME}
            aria-label="Your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // The DOM value is already current inside the handler, so the
              // blank is measured and resized in the same event as the
              // keystroke — an effect would do it a painted frame late.
              fitBlank(bNameRef.current);
              bNameRef.current?.classList.remove('err');
              scope.current?.poke(0.2);
            }}
            onFocus={() => scope.current?.poke(0.12)}
          />
          {/* Written imperatively by fitBlank and never by React, so the two
              cannot fight over its contents. */}
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
          <textarea
            ref={msgRef}
            name="message"
            rows={1}
            maxLength={MAX_MESSAGE}
            placeholder={PH_MSG}
            aria-label="Your message"
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
          <input
            ref={emailRef}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={MAX_EMAIL}
            placeholder={PH_EMAIL}
            aria-label="Your email address"
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

      {purposes.length > 0 && (
        <div className={`chip-rail${railOpen ? ' open' : ''}`} id={railId}>
          {/* The chips are still in the DOM behind a 0fr row when the rail is
              shut, and a tab through an invisible button is worse than no
              disclosure at all. */}
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

      <div className="tx-row">
        <span className={`f-count mono${count > NEAR ? ' near' : ''}`} aria-hidden="true">
          {count}/{MAX_MESSAGE}
        </span>
        <span className="tx-note">{note}</span>
        <span className="tx-spacer" />
        {/* `aria-disabled` rather than `disabled`: a button that becomes
            disabled is blurred by the browser, so pressing Transmit by keyboard
            threw focus to <body> mid-send and the receipt announced into
            nowhere. The guard at the top of `submit` is what actually refuses a
            second transmission. */}
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

      {/* Always mounted and empty at rest — a live region that is populated and
          then unhidden does not reliably announce. The typed line is hidden from
          the tree so the receipt is spoken once rather than per character. */}
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
