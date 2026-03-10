'use client';

import { skillIconMap } from '@/lib/icon-map';

export default function SkillBadge({ name }: { name: string }) {
  const icon = skillIconMap[name];
  return (
    <span className="skill-inner-shadow inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground transition-all duration-200 hover:scale-105">
      {icon && <span className="size-3.5 shrink-0">{icon}</span>}
      {name}
    </span>
  );
}
