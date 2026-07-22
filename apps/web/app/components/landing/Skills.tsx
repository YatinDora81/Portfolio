'use client';

import { useMemo, useState } from 'react';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { skillIconMap } from '@/lib/icon-map';
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

function ElementCard({
  skill,
  dimmed,
  onHover,
  hovered,
}: {
  skill: EnrichedSkill;
  dimmed: boolean;
  hovered: boolean;
  onHover: (n: number | null) => void;
}) {
  const icon = skillIconMap[skill.iconKey] || skillIconMap[skill.name];

  return (
    <button
      type="button"
      aria-label={skill.name}
      onMouseEnter={() => onHover(skill.number)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(skill.number)}
      onBlur={() => onHover(null)}
      style={
        hovered
          ? {
              borderColor: skill.color,
              boxShadow: `0 12px 28px -12px ${hexToRgba(
                skill.color,
                0.6,
              )}, inset 0 0 0 1px ${hexToRgba(skill.color, 0.55)}`,
              transform: 'translateY(-5px) scale(1.08)',
            }
          : undefined
      }
      className={[
        'group/card relative flex aspect-square w-[64px] flex-col items-center justify-between',
        'rounded-xl border border-border bg-card p-1.5 sm:w-[70px]',
        'transition-all duration-300 ease-out will-change-transform',
        dimmed
          ? 'pointer-events-none scale-90 opacity-20 grayscale'
          : 'hover:-translate-y-1',
      ].join(' ')}
    >
      <span className="w-full pl-0.5 text-left font-mono text-[8px] leading-none text-secondary">
        {skill.number}
      </span>

      <span className="flex size-6 items-center justify-center transition-transform duration-300 group-hover/card:scale-110 sm:size-7">
        {icon}
      </span>

      <span className="w-full truncate text-center text-[8px] leading-tight text-secondary transition-colors group-hover/card:text-foreground">
        {skill.name}
      </span>

      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
        style={{
          background: `radial-gradient(circle at 50% 20%, ${hexToRgba(
            skill.color,
            0.16,
          )}, transparent 70%)`,
        }}
      />
    </button>
  );
}

export default function Skills({ skills }: { skills: SkillEntry[] }) {
  const [filter, setFilter] = useState<SkillCategoryId | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Keep the ORIGINAL skill order, all in one continuous grid. Each skill is
  // enriched with its category + accent colour and an atomic-style number.
  const enriched: EnrichedSkill[] = useMemo(
    () =>
      skills.map((s, i) => {
        const meta = getSkillMeta(s.name);
        return { ...s, color: meta.color, category: meta.category, number: i + 1 };
      }),
    [skills],
  );

  const chips = [
    { id: null as SkillCategoryId | null, label: 'all', color: '#909092' },
    ...skillCategories
      .filter((c) => enriched.some((s) => s.category === c.id))
      .map((c) => ({ id: c.id, label: c.label, color: c.color })),
  ];

  return (
    <section id="skills">
      <Container className="mt-20 animate-fade-in-blur animate-delay-4">
        <SectionHeading subHeading="Technical" heading="Skills" />
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-secondary">
          my periodic table of code — everything i build with, in one place. tap a
          category to filter, hover any element to bring it to life.
        </p>

        {/* All skills together in one continuous grid, original order intact. */}
        <div className="mt-8 flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {enriched.map((skill) => {
            const dimmed = filter !== null && filter !== skill.category;
            return (
              <ElementCard
                key={skill.name}
                skill={skill}
                dimmed={dimmed}
                hovered={hovered === skill.number && !dimmed}
                onHover={setHovered}
              />
            );
          })}
        </div>

        {/* Category filter chips */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {chips.map((chip) => {
            const selected = filter === chip.id;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setFilter(chip.id)}
                style={
                  selected
                    ? {
                        borderColor: hexToRgba(chip.color, 0.6),
                        background: hexToRgba(chip.color, 0.12),
                        color: chip.color,
                      }
                    : undefined
                }
                className={[
                  'flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5',
                  'text-xs transition-all duration-200',
                  selected
                    ? 'font-medium'
                    : 'text-secondary hover:border-foreground/20 hover:text-foreground',
                ].join(' ')}
              >
                <span
                  className="size-1.5 rounded-full transition-transform"
                  style={{
                    background: chip.color,
                    transform: selected ? 'scale(1.4)' : 'scale(1)',
                  }}
                />
                {chip.label}
              </button>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
