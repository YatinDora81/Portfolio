'use client';

import { useEffect, useRef, useState } from 'react';
import { m as motion, useInView, useReducedMotion } from 'motion/react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { GraduationCapIcon, MapPinIcon } from '@repo/ui/icons/brand';
import {
  TERMINAL_COMMANDS, NAV_COMMANDS as ALL_NAV_COMMANDS, findCommand,
  type TerminalCommand,
} from '@repo/ui/terminal';

/**
 * About — the terminal is a real shell: it types `whoami` on scroll and prints
 * the CMS paragraphs, then takes commands (section jumps, `help`, `ls`,
 * `clear`, `resume`) with zsh-style ghost completion and ↑/↓ history.
 */

interface EducationEntry {
  institution: string;
  location: string;
  degree: string;
  scoreType: string | null;
  score: string | null;
  scoreTotal: string | null;
  startYear: string;
  endYear: string;
}

interface AboutProps {
  paragraphs: string[];
  education: EducationEntry[];
  resumeUrl?: string;
  /** company name (lower-cased) -> logo url, sourced from the Experience rows */
  companyLogos?: Record<string, string>;
}

const DEFAULT_RESUME_URL =
  'https://drive.google.com/file/d/1eljvOFwiltQbn6EvSiTv1fwjDipTSVI1/view';

/* ---------- markdown-bold -> spans ---------- */

/** Renders `**bold**` CMS markup, showing a company mark inline when a bolded
    run names one — from the same `logoUrl` the Experience section uses. */
function BoldText({ text, logos }: { text: string; logos?: Record<string, string> }) {
  return (
    <>
      {text.split(/\*\*(.*?)\*\*/g).map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const key = part.trim().toLowerCase();
        // `hasOwn`, not a bare read: a bolded `**constructor**` would otherwise
        // resolve up the prototype chain and render its source as an image src.
        const logo = logos && Object.hasOwn(logos, key) ? logos[key] : undefined;
        return (
          <span key={i} className="font-semibold text-foreground">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt=""
                aria-hidden
                width={16}
                height={16}
                className="mr-1 inline-block size-4 rounded-[3px] object-contain align-[-0.2em]"
              />
            )}
            {part}
          </span>
        );
      })}
    </>
  );
}

/* ---------- terminal ---------- */

/**
 * The muted tone is `text-secondary-ink`, a real theme colour — unlike the
 * hand-written `.text-secondary`, where `text-secondary/50` emits no CSS at all
 * and silently falls back to `foreground`. No opacity variant: the ghost and
 * hint lines used to carry /50 and /70, which composited to 1.67:1 and 2.14:1.
 */

const UNLOCK_HINT = "# type 'help' to explore — try \"skills\" ⏎";

// Columns Tab advances to when there's no completion pending.
const TAB_WIDTH = 4;

const CMD = 'whoami';
const TYPE_START = 0.2;
const TYPE_SPEED = 0.055;
const OUTPUT_START = TYPE_START + CMD.length * TYPE_SPEED + 0.3;
const OUTPUT_STAGGER = 0.22;

// Sections come from the shared command table, which the admin also renders as
// a reference page — so there is one list, not two that drift.
const NAV_COMMANDS = ALL_NAV_COMMANDS.map((c) => ({
  cmd: c.cmd, target: c.target, label: c.label,
}));

type Line =
  | { t: 'in'; v: string }
  | { t: 'out'; v: string }
  | { t: 'err'; v: string }
  | { t: 'hint'; v: string }
  | { t: 'about'; v: string };

/** The oh-my-zsh prompt: `➜` then TWO spaces. `whitespace-pre` on the wrapper,
    or the double space collapses in the echoed history lines. */
function Prompt() {
  return (
    <span className="whitespace-pre">
      <span className="text-emerald-500">➜</span>
      {'  '}
      <span className="text-secondary">~</span>
      {' '}
    </span>
  );
}

function Terminal({
  paragraphs,
  resumeUrl,
  logos,
}: {
  paragraphs: string[];
  resumeUrl?: string;
  logos?: Record<string, string>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inView = useInView(wrapRef, { once: true, margin: '-80px' });
  const reduceMotion = useReducedMotion() ?? false;

  const introDone = OUTPUT_START + paragraphs.length * OUTPUT_STAGGER + 0.1;

  const [ready, setReady] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [value, setValue] = useState('');
  // Mirrors the hidden input's selection. `caret` is the *moving* edge, which
  // is selectionEnd on a forward selection and selectionStart on a backward
  // one — that's where a terminal draws its cursor.
  const [sel, setSel] = useState({ start: 0, end: 0, caret: 0 });
  // The hidden input scrolls itself horizontally to keep the caret visible once
  // the line outgrows the terminal; we mirror that offset onto the drawn text
  // so long commands don't just run off the right edge.
  const [shift, setShift] = useState(0);
  const [focused, setFocused] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  // Only the sections actually rendered on the page. Blogs is conditional on
  // the CMS returning posts, so advertising it unconditionally makes `help`
  // and `ls` list a command that can only ever error.
  const [navCmds, setNavCmds] = useState(NAV_COMMANDS);
  // Flips on the first focus and stays on: gates the auto-scroll below without
  // tying it to the *current* focus, so blurring after a command still lets
  // that command's output scroll into view.
  const interacted = useRef(false);

  // Unlock the interactive prompt once the intro finishes.
  useEffect(() => {
    if (!inView) return;
    const delay = reduceMotion ? 0 : introDone * 1000 + 300;
    const t = setTimeout(() => {
      setReady(true);
      setLines([{ t: 'hint', v: UNLOCK_HINT }]);
    }, delay);
    return () => clearTimeout(t);
  }, [inView, reduceMotion, introDone]);

  // Keep the newest line in view inside the terminal body — but only once the
  // user is actually driving the prompt. Otherwise the intro would mount
  // already scrolled to the bottom on narrow screens, where the about text is
  // taller than the terminal's max height.
  useEffect(() => {
    if (!interacted.current) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [focused, lines, value]);

  // Drop nav commands whose section isn't on the page (e.g. #blogs when the
  // CMS has no posts) so they vanish from help, ls and autosuggest too.
  useEffect(() => {
    setNavCmds(NAV_COMMANDS.filter((c) => document.querySelector(c.target)));
  }, [ready]);

  // Nav entries are filtered to what's on the page; the rest come straight
  // from the manifest, minus the easter eggs.
  const allCommands = [
    ...navCmds.map((c) => c.cmd),
    ...TERMINAL_COMMANDS.filter((c) => c.kind !== 'nav' && c.discoverable).map((c) => c.cmd),
  ];

  const suggestion =
    value.length > 0
      ? allCommands.find((c) => c.startsWith(value.toLowerCase()) && c !== value.toLowerCase())
      : undefined;

  // Guard against the selection briefly outliving a shorter buffer (e.g. a
  // history walk back to a shorter entry) between the two state updates.
  const clamp = (n: number) => Math.max(0, Math.min(n, value.length));
  const caretPos = clamp(sel.caret);
  const selStart = clamp(sel.start);
  const selEnd = clamp(sel.end);
  const hasSel = selEnd > selStart;

  const push = (...ls: Line[]) => setLines((prev) => [...prev, ...ls]);

  // Mirror the real selection + horizontal scroll out of the hidden input so
  // the drawn line can follow it (arrow keys, Home/End, clicking, dragging).
  const syncFromInput = (el: HTMLInputElement) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setSel({
      start,
      end,
      caret: el.selectionDirection === 'backward' ? start : end,
    });
    setShift(el.scrollLeft);
  };

  // The DOM input is written directly too: when the new string equals the old
  // one React skips the commit, and the browser would keep the stale selection.
  const setBuffer = (next: string, pos = next.length) => {
    setValue(next);
    setSel({ start: pos, end: pos, caret: pos });
    const el = inputRef.current;
    if (el) {
      el.value = next;
      el.setSelectionRange(pos, pos);
      setShift(el.scrollLeft);
    }
  };

  /**
   * Runs a command and returns it (null for blank input, unknown words and
   * failures). Only a command that TOOK YOU SOMEWHERE drops focus — holding it
   * would leave you typing into an off-screen prompt, and on mobile keep the
   * keyboard over the thing you just scrolled to. The caller reads `keepsFocus`
   * off the result so the admin's reference documents the real behaviour.
   */
  const run = (raw: string): TerminalCommand | null => {
    const trimmed = raw.trim();
    push({ t: 'in', v: raw });
    if (!trimmed) return null;

    setHist((h) => [...h, raw]);
    setHistIdx(null);

    const name = trimmed.split(/\s+/)[0]!.toLowerCase();

    if (name === 'clear') {
      setLines([]);
      return findCommand('clear') ?? null;
    }
    if (name === 'help') {
      push(
        { t: 'out', v: 'available commands:' },
        ...navCmds.map((c) => ({ t: 'out' as const, v: `  ${c.cmd.padEnd(12)}→ jump to ${c.label}` })),
        ...TERMINAL_COMMANDS.filter((c) => c.kind !== 'nav' && c.discoverable).map((c) => ({
          t: 'out' as const, v: `  ${c.cmd.padEnd(12)}→ ${c.summary}`,
        })),
        { t: 'hint', v: '# tip: Tab autocompletes (or indents), ↑ replays history, Esc exits' }
      );
      return findCommand('help') ?? null;
    }
    if (name === 'ls') {
      push({ t: 'out', v: navCmds.map((c) => c.cmd).join('  ') });
      return findCommand('ls') ?? null;
    }
    if (name === 'whoami') {
      push(...paragraphs.map((p) => ({ t: 'about' as const, v: p })));
      return findCommand('whoami') ?? null;
    }
    if (name === 'resume' || name === 'cv') {
      push({ t: 'out', v: '→ opening resume…' });
      if (resumeUrl) window.open(resumeUrl, '_blank', 'noopener,noreferrer');
      return findCommand('resume') ?? null;
    }
    if (name === 'sudo') {
      push({ t: 'err', v: '[sudo] password for yatin: ✗ — nice try 😉' });
      return findCommand('sudo') ?? null;
    }
    if (name === 'cat') {
      push({ t: 'out', v: '🐾 the cat is in the navbar, not in the terminal' });
      return findCommand('cat') ?? null;
    }

    const nav = navCmds.find((c) => c.cmd === name);
    if (nav) {
      const el = document.querySelector(nav.target);
      if (!el) {
        push({ t: 'err', v: `section ${nav.target} not found on this page` });
        return null;
      }
      push({ t: 'out', v: `→ taking you to ${nav.label}…` });
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
      return findCommand(name) ?? null;
    }

    push(
      { t: 'err', v: `zsh: command not found: ${name}` },
      { t: 'hint', v: "# type 'help' to see available commands" }
    );
    return null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const cmd = run(value);
      setBuffer('');
      // The manifest decides. Only commands that moved you release the prompt
      // (which also closes the mobile keyboard); anything that answered
      // in-place keeps the caret, so `ls` → `skills` is one unbroken flow.
      if (cmd && !cmd.keepsFocus) inputRef.current?.blur();
      return;
    }
    if (e.key === 'Escape') {
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Tab') {
      // Shift+Tab is deliberately left alone: together with Esc it's the way
      // out of the prompt, so Tab indenting doesn't become a keyboard trap.
      if (e.shiftKey) return;
      e.preventDefault();
      // A pending completion wins, exactly like zsh.
      if (suggestion) {
        setBuffer(suggestion);
        return;
      }
      // Otherwise indent to the next tab stop, the way a real terminal does,
      // instead of throwing focus out to the next control on the page.
      const el = e.currentTarget;
      const from = el.selectionStart ?? value.length;
      const to = el.selectionEnd ?? from;
      const pad = ' '.repeat(TAB_WIDTH - (from % TAB_WIDTH));
      setBuffer(value.slice(0, from) + pad + value.slice(to), from + pad.length);
      return;
    }
    if (e.key === 'ArrowRight') {
      const input = e.currentTarget;
      const atEnd = input.selectionStart === value.length;
      if (atEnd && suggestion) {
        e.preventDefault();
        setBuffer(suggestion);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hist.length === 0) return;
      const idx = histIdx === null ? hist.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setBuffer(hist[idx]!);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === null) return;
      const next = histIdx + 1;
      if (next >= hist.length) {
        setHistIdx(null);
        setBuffer('');
      } else {
        setHistIdx(next);
        setBuffer(hist[next]!);
      }
    }
  };

  const renderLine = (l: Line, i: number) => {
    if (l.t === 'in')
      return (
        <div key={i} className="text-foreground">
          <Prompt />
          {l.v}
        </div>
      );
    if (l.t === 'err')
      return (
        <div key={i} className="whitespace-pre-wrap text-red-400">
          {l.v}
        </div>
      );
    if (l.t === 'hint')
      return (
        <div key={i} className="whitespace-pre-wrap italic text-secondary-ink">
          {l.v}
        </div>
      );
    if (l.t === 'about')
      return (
        <p key={i} className="m-0 whitespace-pre-wrap text-secondary">
          <BoldText text={l.v} logos={logos} />
        </p>
      );
    return (
      <div key={i} className="whitespace-pre-wrap text-secondary">
        {l.v}
      </div>
    );
  };

  return (
    <motion.div
      ref={wrapRef}
      initial={reduceMotion ? false : 'hidden'}
      animate={inView || reduceMotion ? 'show' : 'hidden'}
      onClick={() => inputRef.current?.focus()}
      className="mt-4 cursor-text overflow-hidden rounded-2xl border border-border bg-card"
    >
      {/* title bar */}
      <div className="relative flex items-center gap-1.5 border-b border-border bg-muted/50 px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="absolute inset-x-0 text-center font-mono text-xs text-secondary">
          yatin@portfolio — zsh
        </span>
      </div>

      {/* body */}
      <div
        ref={bodyRef}
        className="max-h-[420px] overflow-y-auto p-5 font-mono text-sm leading-relaxed sm:p-6"
      >
        {/* intro: typed whoami */}
        <div className="text-foreground">
          <Prompt />
          {CMD.split('').map((ch, i) => (
            <motion.span
              key={i}
              className="js-reveal"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { duration: 0, delay: TYPE_START + i * TYPE_SPEED } },
              }}
            >
              {ch}
            </motion.span>
          ))}
        </div>

        {/* intro: output */}
        <div className="mt-3 space-y-3 text-secondary">
          {paragraphs.map((p, i) => (
            <motion.p
              key={i}
              className="m-0 js-reveal"
              variants={{
                hidden: { opacity: 0, y: 6, filter: 'blur(4px)' },
                show: {
                  opacity: 1,
                  y: 0,
                  filter: 'blur(0px)',
                  transition: { duration: 0.45, ease: 'easeOut', delay: OUTPUT_START + i * OUTPUT_STAGGER },
                },
              }}
            >
              <BoldText text={p} logos={logos} />
            </motion.p>
          ))}
        </div>

        {/* interactive history — an invisible filler line holds this row's
            height while the history is empty (before the prompt unlocks, and
            after `clear`) so the terminal never resizes on its own */}
        {/* role="log": every command's output lands here, and without a live
            region a screen-reader visitor typed `help`, got ten lines of
            command list appended above the caret, and heard nothing at all —
            including the "taking you to Projects…" line that comes with a
            silent scroll. `aria-atomic=false` so only the new lines speak. */}
        <div className="mt-3 space-y-1.5" role="log" aria-live="polite" aria-atomic="false">
          {lines.length > 0 ? (
            lines.map(renderLine)
          ) : (
            // Holds the *actual* hint text so it wraps to the same number of
            // lines the real hint will. A one-line `&nbsp;` under-reserved on
            // narrow screens, where the hint wraps to two.
            <div aria-hidden className="invisible whitespace-pre-wrap italic">
              {UNLOCK_HINT}
            </div>
          )}
        </div>

        {/* live input line — always occupies the layout, just hidden until the
            intro finishes, so unlocking the prompt doesn't grow the terminal.
            `invisible` (visibility:hidden) also keeps the input un-focusable
            and out of the tab order while it's hidden. */}
        <div
          className={`relative mt-1.5 flex items-center ${ready ? '' : 'invisible'}`}
          aria-hidden={!ready}
        >
          {/* `whitespace-pre` keeps the trailing space Prompt emits — as a
              flex item its own inline context would otherwise collapse it, and
              the live line would sit a character left of the echoed ones. */}
          <span className="shrink-0 whitespace-pre">
            <Prompt />
          </span>

          {/* Everything after the prompt shares one positioning context, and
              the hidden input is stretched over *this* box rather than the
              whole row. That matters: the input is what the browser hit-tests
              when you click, so if its text box doesn't start exactly where the
              drawn buffer starts, clicking lands the caret off by the width of
              the prompt (which was 3 characters). */}
          <span className="relative min-w-0 flex-1 overflow-hidden">
            {/* mirrors the hidden input's own horizontal scroll, so a long
                command follows the caret instead of running off the edge */}
            {/* the empty `after` is a strut: with an empty buffer the only
                content here is the absolutely-positioned cursor, which adds no
                height, and the row would collapse to 0px (taking the hidden
                input with it, making the prompt unclickable) */}
            <span
              className="block whitespace-pre will-change-transform after:inline-block after:content-['']"
              style={{ transform: `translateX(${-shift}px)` }}
            >
              <span className="relative text-foreground">
                {hasSel ? (
                  <>
                    {value.slice(0, selStart)}
                    <span className="bg-foreground/25">
                      {value.slice(selStart, selEnd)}
                    </span>
                    {value.slice(selEnd)}
                  </>
                ) : (
                  value
                )}
                {/* Cursor as an overlay placed by character index rather than
                    an inline block after the text: the font is monospace, so
                    1ch is exactly one glyph. It therefore sits on the real
                    caret when you arrow or click backwards, and moving it
                    never nudges the text sideways. */}
                {reduceMotion || !focused ? (
                  <span
                    className={`absolute inset-y-0 my-auto h-4 w-[1ch] ${
                      focused ? 'bg-foreground/80' : 'border border-foreground/40'
                    }`}
                    style={{ left: `${caretPos}ch` }}
                  />
                ) : (
                  <motion.span
                    className="absolute inset-y-0 my-auto h-4 w-[1ch] bg-foreground/80"
                    style={{ left: `${caretPos}ch` }}
                    animate={{ opacity: [1, 1, 0, 0] }}
                    transition={{ duration: 1.1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
                  />
                )}
              </span>
              {/* zsh-style ghost suggestion */}
              {suggestion && (
                <span className="text-secondary-ink">
                  {suggestion.slice(value.length)}
                </span>
              )}
            </span>

            {/* hidden input that actually captures the keystrokes */}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                syncFromInput(e.target);
                setHistIdx(null);
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => syncFromInput(e.currentTarget)}
              onSelect={(e) => syncFromInput(e.currentTarget)}
              onScroll={(e) => setShift(e.currentTarget.scrollLeft)}
              onFocus={(e) => {
                interacted.current = true;
                setFocused(true);
                syncFromInput(e.currentTarget);
              }}
              onBlur={() => setFocused(false)}
              // pr-[1ch]: the browser scrolls to keep its thin caret in view
              // but we draw a 1ch block, which would overhang without the extra
              // scroll extent. padding-left must stay 0 — it aligns the text box
              // (and hit-testing) with the drawn text.
              className="absolute inset-0 h-full w-full cursor-text bg-transparent py-0 pl-0 pr-[1ch] opacity-0 outline-none"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="Terminal input — type help for commands, Escape or Shift+Tab to leave"
            />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- CGPA / percentage ring ---------- */

function ScoreRing({
  score,
  scoreTotal,
  scoreType,
  reduceMotion,
}: {
  score: string;
  scoreTotal: string | null;
  scoreType: string | null;
  reduceMotion: boolean;
}) {
  const value = parseFloat(score);
  const total = scoreType === 'CGPA' ? parseFloat(scoreTotal ?? '10') || 10 : 100;
  const pct = Math.max(0, Math.min(1, value / total));

  return (
    <div
      className="relative size-16 shrink-0"
      title={`${scoreType ?? 'Score'}: ${score}${scoreType === 'CGPA' ? `/${total}` : '%'}`}
    >
      <svg viewBox="0 0 40 40" className="size-16 -rotate-90">
        <circle cx="20" cy="20" r="16.5" fill="none" strokeWidth="2.5" className="stroke-border" />
        <motion.circle
          cx="20"
          cy="20"
          r="16.5"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-foreground"
          initial={{ pathLength: reduceMotion ? pct : 0 }}
          whileInView={{ pathLength: pct }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-sm font-bold text-foreground">{score}</span>
        <span className="mt-0.5 text-[9px] text-secondary">
          {scoreType === 'CGPA' ? `/ ${total}` : '%'}
        </span>
      </div>
    </div>
  );
}

/* ---------- main ---------- */

export default function About({ paragraphs, education, resumeUrl, companyLogos }: AboutProps) {
  const reduceMotion = useReducedMotion() ?? false;

  // `id` is the hero scroll cue's target; mt-11 is the spec's 2.75rem gap,
  // measured from the cat-wire bridge that now sits directly above.
  return (
    <Container id="about" className="cv-auto mt-11 animate-fade-in-blur animate-delay-1">
      <SectionHeading subHeading="About" heading="Who I am" />

      <Terminal
        paragraphs={paragraphs}
        resumeUrl={resumeUrl || DEFAULT_RESUME_URL}
        logos={companyLogos}
      />

      {/* ── Education timeline (id lets the terminal navigate here) ── */}
      {education.length > 0 && (
        <div id="education" className="mt-8 scroll-mt-24">
          <p className="text-secondary text-xs uppercase tracking-[0.2em]">Education</p>

          <div className="relative mt-4 space-y-4 pl-8">
            <div
              aria-hidden
              className="absolute bottom-3 left-[11px] top-3 w-px border-l border-dashed border-border"
            />

            {education.map((edu, i) => (
              <motion.div
                key={i}
                initial={reduceMotion ? undefined : { opacity: 0, x: -12, filter: 'blur(4px)' }}
                whileInView={reduceMotion ? undefined : { opacity: 1, x: 0, filter: 'blur(0px)' }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, ease: 'easeOut', delay: i * 0.1 }}
                // js-reveal, like the bio paragraphs: motion renders this at
                // inline opacity:0 on the server and only animates it to visible
                // on mount, so without scripting the whole entry stayed blank.
                className="relative js-reveal"
              >
                <div className="absolute -left-8 top-4 flex size-6 items-center justify-center rounded-full border border-border bg-background text-secondary">
                  <span className="size-1.5 rounded-full bg-current" />
                </div>

                <div className="group/edu flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/50 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:bg-muted">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="font-semibold">{edu.institution}</h3>
                      <span className="inline-flex h-6 items-center rounded-lg border border-dashed border-border bg-background px-2 text-xs font-medium text-secondary">
                        {edu.startYear} — {edu.endYear}
                      </span>
                    </div>

                    <p className="mt-1 flex items-center gap-1.5 text-sm text-secondary">
                      <GraduationCapIcon className="size-4 shrink-0" />
                      {edu.degree}
                    </p>

                    {edu.location && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-secondary">
                        <MapPinIcon className="size-4 shrink-0" />
                        {edu.location}
                      </p>
                    )}
                  </div>

                  {edu.score && (
                    <ScoreRing
                      score={edu.score}
                      scoreTotal={edu.scoreTotal}
                      scoreType={edu.scoreType}
                      reduceMotion={reduceMotion}
                    />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </Container>
  );
}
