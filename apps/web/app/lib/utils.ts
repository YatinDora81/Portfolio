import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const SKILL_ALIASES: Record<string, string> = {
  'React.js': 'React',
  'WebSocket': 'WebSockets',
  'Drizzle': 'Drizzle ORM',
};

export const canonicalSkill = (name: string) => SKILL_ALIASES[name] ?? name;
