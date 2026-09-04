'use client';

import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { useTheme } from '../common/ThemeProvider';
import { skillIconMap } from '@repo/ui/icons/registry';
import {
  getSkillMeta,
  skillCategories,
  type SkillCategoryId,
} from '@/lib/skill-meta';
import { canonicalSkill } from '@/lib/utils';

interface SkillEntry {
  name: string;
  iconKey: string;
}

interface EnrichedSkill extends SkillEntry {
  symbol: string;
  color: string;
  category: SkillCategoryId;
  number: number;
}

export interface UsedIn {
  name: string;
  href: string;
  logoUrl: string | null;
  kind: 'job' | 'build';
}

export type UsedInMap = Record<string, UsedIn[]>;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tune(hex: string, isDark: boolean): string {
  if (isDark) return hex;
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum <= 160) return hex;
  const k = Math.min(0.5, ((lum - 160) / 95) * 0.5);
  const d = (v: number) =>
    Math.round(v * (1 - k))
      .toString(16)
      .padStart(2, '0');
  return `#${d(r)}${d(g)}${d(b)}`;
}

function ElementCard({
  skill,
  index,
  dimmed,
  hovered,
  pinned,
  isDark,
  onHover,
  onSelect,
}: {
  skill: EnrichedSkill;
  index: number;
  dimmed: boolean;
  hovered: boolean;
  pinned: boolean;
  isDark: boolean;
  onHover: (n: number | null) => void;
  onSelect: (n: number) => void;
}) {
  const icon = skillIconMap[skill.iconKey] || skillIconMap[skill.name];
  const c = tune(skill.color, isDark);

  return (
    <div
      className="animate-fade-in-blur"
      style={{ animationDelay: `${Math.min(index * 18, 500)}ms` }}
    >
      <button
        type="button"
        data-skills-control="card"
        aria-label={skill.name}
        aria-pressed={pinned}
        tabIndex={dimmed ? -1 : 0}
        onMouseEnter={() => onHover(skill.number)}
        onFocus={() => onHover(skill.number)}
        onBlur={(e) => {
          if (!e.relatedTarget?.closest('.sk-live')) onHover(null);
        }}
        onClick={() => onSelect(skill.number)}
        style={
          hovered
            ? {
                background: hexToRgba(c, isDark ? 0.1 : 0.08),
                transform: 'translateY(-3px) scale(1.04)',
              }
            : undefined
        }
        className={[
          'group/card relative flex aspect-square w-[70px] flex-col justify-between overflow-hidden',
          'rounded-lg border-0 bg-transparent p-1.5 sm:w-[78px]',
          'transition-[transform,background-color,opacity,filter] duration-300 ease-out will-change-transform',
          'focus-visible:ring-2 focus-visible:ring-foreground/70',
          dimmed
            ? 'pointer-events-none scale-90 opacity-15 grayscale'
            : 'hover:-translate-y-0.5 hover:bg-foreground/[0.03]',
        ].join(' ')}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2.5 top-0 h-[2px] rounded-b-full transition-[background,box-shadow] duration-300"
          style={{
            background: hexToRgba(c, hovered ? 1 : 0.4),
            boxShadow: hovered ? `0 0 10px ${hexToRgba(c, 0.8)}` : 'none',
          }}
        />

        <span className="flex w-full items-start justify-between pt-1">
        </span>

        <span className="flex size-6 items-center justify-center self-center transition-transform duration-300 group-hover/card:scale-110 sm:size-7">
          {icon ?? (
            <span
              className="text-[13px] font-extrabold leading-none tracking-tight"
              style={{ color: c }}
            >
              {skill.symbol}
            </span>
          )}
        </span>

        <span className="w-full truncate text-center text-[8px] leading-tight text-secondary transition-colors duration-300 group-hover/card:text-foreground">
          {skill.name}
        </span>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
          style={{
            background: `radial-gradient(circle at 50% 0%, ${hexToRgba(
              c,
              0.18,
            )}, transparent 70%)`,
          }}
        />
      </button>
    </div>
  );
}

export default function Skills({
  skills,
  usedIn = {},
}: {
  skills: SkillEntry[];
  usedIn?: UsedInMap;
}) {
  const [filter, setFilter] = useState<SkillCategoryId | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    if (filter === null && pinned === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-skills-control], .sk-live')) return;
      setFilter(null);
      setPinned(null);
      setHovered(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [filter, pinned]);

  useEffect(() => {
    const el = liveRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        setStuck(
          e.intersectionRatio < 1 &&
            e.boundingClientRect.bottom >= window.innerHeight - 16,
        );
      },
      { threshold: [1], rootMargin: '0px 0px -16px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const enriched: EnrichedSkill[] = useMemo(
    () =>
      skills.map((s, i) => {
        const meta = getSkillMeta(s.name);
        return {
          ...s,
          symbol: meta.symbol,
          color: meta.color,
          category: meta.category,
          number: i + 1,
        };
      }),
    [skills],
  );

  const categoryLabel = useMemo(
    () =>
      Object.fromEntries(skillCategories.map((c) => [c.id, c.label])) as Record<
        SkillCategoryId,
        string
      >,
    [],
  );

  const counts = useMemo(() => {
    const m = new Map<SkillCategoryId, number>();
    enriched.forEach((s) => m.set(s.category, (m.get(s.category) ?? 0) + 1));
    return m;
  }, [enriched]);

  const chips = [
    {
      id: null as SkillCategoryId | null,
      label: 'All',
      color: isDark ? '#909092' : '#6e6e70',
      count: enriched.length,
    },
    ...skillCategories
      .filter((c) => (counts.get(c.id) ?? 0) > 0)
      .map((c) => ({
        id: c.id as SkillCategoryId | null,
        label: c.label,
        color: c.color,
        count: counts.get(c.id) ?? 0,
      })),
  ];

  const active = hovered ?? pinned;
  const activeSkill =
    active !== null ? enriched.find((s) => s.number === active) : undefined;
  const activeColor = activeSkill ? tune(activeSkill.color, isDark) : '';
  const activeUses = activeSkill
    ? (usedIn[canonicalSkill(activeSkill.name)] ?? [])
    : [];

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = [
      'ArrowRight',
      'ArrowLeft',
      'ArrowDown',
      'ArrowUp',
      'Home',
      'End',
    ];
    if (!keys.includes(e.key)) return;
    const grid = e.currentTarget;
    const cards = Array.from(
      grid.querySelectorAll<HTMLButtonElement>(
        'button[data-skills-control="card"]:not([tabindex="-1"])',
      ),
    );
    const current =
      document.activeElement instanceof HTMLButtonElement
        ? cards.indexOf(document.activeElement)
        : -1;
    if (current < 0) return;
    e.preventDefault();
    const first = cards[0];
    const perRow = first
      ? Math.max(1, Math.round(grid.clientWidth / (first.offsetWidth + 8)))
      : 1;
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      ArrowDown: current + perRow,
      ArrowUp: current - perRow,
      Home: 0,
      End: cards.length - 1,
    };
    const target = moves[e.key];
    if (target === undefined) return;
    cards[Math.min(cards.length - 1, Math.max(0, target))]?.focus();
  };

  return (
    <section id="skills">
      <Container className="mt-20 animate-fade-in-blur animate-delay-4">
        <div onMouseLeave={() => setHovered(null)}>
          <SectionHeading
            channel="02"
            label="skills"
            title="Periodic table."
            hint={`${skills.length} elements`}
          />
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
            my periodic table of code — everything i build with, in one place.
            tap a category to filter, hover any element to bring it to life —
            and see where i&apos;ve actually used it.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            {chips.map((chip) => {
              const selected = filter === chip.id;
              const cc = tune(chip.color, isDark);
              return (
                <button
                  key={chip.label}
                  type="button"
                  data-skills-control="chip"
                  aria-pressed={selected}
                  onClick={() => {
                    setFilter(chip.id);
                    setPinned(null);
                    setHovered(null);
                  }}
                  style={
                    selected
                      ? {
                          borderColor: hexToRgba(cc, 0.6),
                          background: hexToRgba(cc, 0.12),
                          color: cc,
                        }
                      : undefined
                  }
                  className={[
                    'flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5',
                    'text-xs transition-[color,background-color,border-color] duration-200',
                    selected
                      ? 'font-medium'
                      : 'text-secondary hover:border-foreground/20 hover:text-foreground',
                  ].join(' ')}
                >
                  <span
                    className="size-1.5 rounded-full transition-transform duration-200"
                    style={{
                      background: cc,
                      transform: selected ? 'scale(1.4)' : 'scale(1)',
                    }}
                  />
                  {chip.label}
                  {selected && chip.id !== null && (
                    <span className="font-mono text-[10px]">{chip.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            className="mt-6 flex flex-wrap justify-center gap-1.5 sm:gap-2"
            role="group"
            aria-label="Skills"
            onKeyDown={onGridKeyDown}
          >
            {enriched.map((skill, i) => {
              const dimmed = filter !== null && filter !== skill.category;
              return (
                <ElementCard
                  key={skill.name}
                  skill={skill}
                  index={i}
                  dimmed={dimmed}
                  hovered={active === skill.number && !dimmed}
                  pinned={pinned === skill.number}
                  isDark={isDark}
                  onHover={setHovered}
                  onSelect={(n) => setPinned((p) => (p === n ? null : n))}
                />
              );
            })}
          </div>

          <div
            ref={liveRef}
            aria-live="polite"
            onBlur={(e) => {
              if (!e.relatedTarget?.closest('[data-skills-control], .sk-live'))
                setHovered(null);
            }}
            className={`sk-live${activeSkill ? ' on' : ''}${stuck ? ' stuck' : ''}`}
          >
            {activeSkill && (
              <>
                <span
                  className="dot"
                  style={{
                    background: activeColor,
                    boxShadow: `0 0 8px ${hexToRgba(activeColor, 0.8)}`,
                  }}
                />
                <span className="name">{activeSkill.name}</span>
                <span className="sep" aria-hidden>
                  —
                </span>
                <span>{categoryLabel[activeSkill.category]}</span>
                {activeUses.length > 0 && (
                  <>
                    <span className="sep" aria-hidden>
                      ·
                    </span>
                    <span className="k">used in</span>
                    {activeUses.map((u) => (
                      <a key={u.href} href={u.href}>
                        {u.logoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.logoUrl} alt="" width={13} height={13} />
                        )}
                        {u.name}
                      </a>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
