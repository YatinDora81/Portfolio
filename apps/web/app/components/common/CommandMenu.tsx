'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NAV_COMMANDS } from '@repo/ui/terminal';
import { useTheme } from './ThemeProvider';
import { useCat } from './CatProvider';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export const OPEN_EVENT = 'cmdk:open';

type Group = 'jump' | 'toggle' | 'reach';
const GROUPS: Group[] = ['jump', 'toggle', 'reach'];

interface Command {
  id: string;
  group: Group;
  icon: string;
  label: string;
  sub: string;
  keys: string;
  run: () => 'keep' | undefined;
}

export interface CommandMenuBuild {
  title: string;
  live: string | null;
}

interface CommandMenuProps {
  sections: Record<string, boolean>;
  contactEmail: string;
  resumeUrl: string;
  builds: CommandMenuBuild[];
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sweepOriginFromNavbar() {
  const btn = Array.from(document.querySelectorAll<HTMLElement>('[data-theme-toggle]')).find((b) => b.offsetWidth > 0);
  if (!btn) return undefined;
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export default function CommandMenu({ sections, contactEmail, resumeUrl, builds }: CommandMenuProps) {
  const { toggleTheme } = useTheme();
  const { toggleCat } = useCat();
  const reduce = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    lastFocus.current?.focus();
  }, []);

  const jump = useCallback(
    (target: string) => {
      document.querySelector(target)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    },
    [reduce],
  );

  const commands = useMemo<Command[]>(() => {
    const present = (target: string) => {
      const id = target.replace(/^#/, '');
      if (id === 'education') return sections.about !== false;
      return sections[id] !== false;
    };
    const jumps: Command[] = NAV_COMMANDS.filter((c) => present(c.target)).map((c, i) => ({
      id: `jump-${c.cmd}`,
      group: 'jump',
      icon: String(i + 1).padStart(2, '0'),
      label: c.label,
      sub: c.summary,
      keys: c.cmd,
      run: () => {
        jump(c.target);
        return undefined;
      },
    }));
    const toggles: Command[] = [
      {
        id: 'theme',
        group: 'toggle',
        icon: '◐',
        label: 'Toggle theme',
        sub: 'sweeps from the navbar',
        keys: 'theme',
        run: () => {
          toggleTheme(sweepOriginFromNavbar());
          return undefined;
        },
      },
      {
        id: 'cat',
        group: 'toggle',
        icon: '🐾',
        label: 'Toggle the cat',
        sub: 'oneko',
        keys: 'cat',
        run: () => {
          toggleCat();
          return undefined;
        },
      },
    ];
    const reach: Command[] = [
      {
        id: 'copy',
        group: 'reach',
        icon: '@',
        label: 'Copy email',
        sub: contactEmail,
        keys: 'copy',
        run: () => {
          navigator.clipboard
            .writeText(contactEmail)
            .then(() => setCopied(true))
            .catch(() => undefined);
          return 'keep';
        },
      },
      {
        id: 'resume',
        group: 'reach',
        icon: '↗',
        label: 'Open resume',
        sub: 'new tab',
        keys: 'cv',
        run: () => {
          window.open(resumeUrl, '_blank', 'noopener,noreferrer');
          return undefined;
        },
      },
    ];
    builds.forEach((b, i) => {
      const live = b.live;
      if (!live) return;
      reach.push({
        id: `build-${i}`,
        group: 'reach',
        icon: '↗',
        label: `Open ${b.title}`,
        sub: hostOf(live),
        keys: `b ${i + 1}`,
        run: () => {
          window.open(live, '_blank', 'noopener,noreferrer');
          return undefined;
        },
      });
    });
    return [...jumps, ...toggles, ...reach];
  }, [sections, builds, contactEmail, resumeUrl, jump, toggleTheme, toggleCat]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.sub} ${c.keys} ${c.group}`.toLowerCase().includes(q));
  }, [commands, query]);

  const selected = Math.min(sel, Math.max(0, shown.length - 1));

  const run = useCallback(
    (index: number) => {
      const cmd = shown[index];
      if (!cmd) return;
      if (cmd.run() !== 'keep') close();
    },
    [shown, close],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setSel(0);
    setCopied(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, selected]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(Math.min(shown.length - 1, selected + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(Math.max(0, selected - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(selected);
    }
  };

  let lastGroup: Group | null = null;
  const activeCmd = shown[selected];

  return (
    <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
      <div className="cmdk-veil" onClick={close} />
      <div className="cmdk-box">
        <div className="cmdk-row">
          <span className="cmdk-prompt" aria-hidden="true">
            <b>➜</b>{'  ~ '}
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="jump, toggle, copy…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={activeCmd ? `cmdk-opt-${activeCmd.id}` : undefined}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <kbd className="kbd">esc</kbd>
        </div>

        <div ref={listRef} id="cmdk-list" className="cmdk-list" role="listbox" aria-label="Commands">
          {shown.length === 0 && <div className="cmdk-empty">zsh: command not found: {query}</div>}
          {shown.map((c, i) => {
            const header = GROUPS.includes(c.group) && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const isCopyDone = c.id === 'copy' && copied;
            return (
              <div key={c.id}>
                {header && <div className="cmdk-group">{header}</div>}
                <div
                  id={`cmdk-opt-${c.id}`}
                  role="option"
                  aria-selected={i === selected}
                  className="cmdk-item"
                  onMouseMove={() => {
                    if (i !== selected) setSel(i);
                  }}
                  onClick={() => run(i)}
                >
                  <span className="ic">{c.icon}</span>
                  <span className={`lb${isCopyDone ? ' ok' : ''}`}>{isCopyDone ? 'copied ✓' : c.label}</span>
                  <span className="sb">{c.sub}</span>
                  <kbd className="kbd">{c.keys}</kbd>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cmdk-foot">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <i />
          <span>same registry as the terminal</span>
        </div>
      </div>
    </div>
  );
}
