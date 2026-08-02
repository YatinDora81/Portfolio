'use client';

/**
 * Skills — "Periodic Table v2.4"
 *
 * v2.4: light mode glow-up — bright brand colors (JS yellow, Linux yellow,
 *       Next.js near-white…) auto-darken on white via a luminance check, and
 *       cards get a soft resting elevation shadow (dark mode is untouched).
 * v2.3: skills with no icon in icon-map fall back to their element symbol.
 * v2.2: clicking anywhere outside the chips/cards resets the filter to "all".
 * v2.1 fix: the stagger animation lives on a WRAPPER div, not the card.
 */

import { useEffect, useMemo, useState } from 'react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { useTheme } from '../common/ThemeProvider';
import { skillIconMap } from '@repo/ui/icons/registry';
import {
  getSkillMeta,
  skillCategories,
  type SkillCategoryId,
} from '@/lib/skill-meta';

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

/**
 * Brand colors are picked for dark backgrounds; on white, bright ones
 * (yellows, cyans, near-whites) wash out. In light mode, darken any color
 * whose luminance is too high — proportionally, so mid-tones keep their hue.
 * Dark mode returns the color untouched.
 */
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
  isDark,
  onHover,
}: {
  skill: EnrichedSkill;
  index: number;
  dimmed: boolean;
  hovered: boolean;
  isDark: boolean;
  onHover: (n: number | null) => void;
}) {
  const icon = skillIconMap[skill.iconKey] || skillIconMap[skill.name];
  const c = tune(skill.color, isDark);

  return (
    // Animation wrapper — entry stagger ONLY. Never put the entry animation on
    // the interactive card itself: `forwards` fill overrides hover transforms.
    <div
      className="animate-fade-in-blur"
      style={{ animationDelay: `${Math.min(index * 18, 500)}ms` }}
    >
      <button
        type="button"
        data-skills-control="card"
        aria-label={skill.name}
        // Out of the tab order while dimmed, alongside the pointer-events
        // removal. `opacity` composites the focus ring's own box-shadow, so a
        // dimmed card at opacity-15 takes a 3:1 ring down to 1.26:1 — a tab
        // stop with no visible focus position at all.
        tabIndex={dimmed ? -1 : 0}
        onMouseEnter={() => onHover(skill.number)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(skill.number)}
        onBlur={() => onHover(null)}
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
        {/* category accent hairline */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2.5 top-0 h-[2px] rounded-b-full transition-[background,box-shadow] duration-300"
          style={{
            background: hexToRgba(c, hovered ? 1 : 0.4),
            boxShadow: hovered ? `0 0 10px ${hexToRgba(c, 0.8)}` : 'none',
          }}
        />

        {/* atomic number + element symbol */}
        <span className="flex w-full items-start justify-between pt-1">
          {/* <span className="font-mono text-[8px] leading-none text-secondary">
            {pad(skill.number)}
          </span>
          <span
            className="font-mono text-[8px] font-semibold leading-none transition-colors duration-300"
            style={{ color: hovered ? c : hexToRgba(c, 0.6) }}
          >
            {skill.symbol}
          </span> */}
        </span>

        <span className="flex size-6 items-center justify-center self-center transition-transform duration-300 group-hover/card:scale-110 sm:size-7">
          {icon ?? (
            // No icon in the icon-map? Show the element symbol instead —
            // every card always looks intentional, never an empty hole.
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

        {/* brand-colored spotlight */}
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

export default function Skills({ skills }: { skills: SkillEntry[] }) {
  const [filter, setFilter] = useState<SkillCategoryId | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // A filter is active → clicking anywhere that ISN'T a chip or a skill card
  // (empty space, other sections, even a dimmed card) resets back to "all".
  useEffect(() => {
    if (filter === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-skills-control]')) return;
      setFilter(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [filter]);

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
      // `tune()` only darkens above a luminance of 160 and this grey sits at
      // 144, so it passes through untouched — which left the light theme at
      // 3.19:1. The two values are the `--secondary-ink` pair.
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

  const hoveredSkill =
    hovered !== null ? enriched.find((s) => s.number === hovered) : undefined;
  const hoveredColor = hoveredSkill ? tune(hoveredSkill.color, isDark) : '';

  return (
    <section id="skills">
      <Container className="mt-20 animate-fade-in-blur animate-delay-4">
        <SectionHeading subHeading="Technical" heading="Skills" />
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
          my periodic table of code — everything i build with, in one place. tap
          a category to filter, hover any element to bring it to life.
        </p>

        {/* Category filter chips — on top, with counts */}
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
                onClick={() => setFilter(chip.id)}
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

        {/* The table — one continuous grid, original order intact */}
        <div className="mt-6 flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {enriched.map((skill, i) => {
            const dimmed = filter !== null && filter !== skill.category;
            return (
              <ElementCard
                key={skill.name}
                skill={skill}
                index={i}
                dimmed={dimmed}
                hovered={hovered === skill.number && !dimmed}
                isDark={isDark}
                onHover={setHovered}
              />
            );
          })}
        </div>

        {/* Live readout — stable height, shows the hovered element */}
        <div className="mt-6 flex h-5 items-center justify-center gap-2 font-mono text-[11px] text-secondary">
          {hoveredSkill && (
            <>
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  background: hoveredColor,
                  boxShadow: `0 0 8px ${hexToRgba(hoveredColor, 0.8)}`,
                }}
              />
              <span className="text-foreground">{hoveredSkill.name}</span>
              <span aria-hidden>—</span>
              <span>{categoryLabel[hoveredSkill.category]}</span>
            </>
          )}
        </div>
      </Container>
    </section>
  );
}
