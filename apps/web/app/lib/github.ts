import { prisma } from 'db';
import {
  bestStreak,
  buildWeeks,
  currentStreak,
  daysInYear,
  dayOfYear,
  decodeYear,
  mergeYear,
  observedIndex,
  windowStart,
} from './github-codec';

const API = 'https://github-contributions-api.jogruber.de/v4';

const MIN_DAYS = 300;

const REFRESH_AFTER_HOURS = 20;

export interface GithubActivity {
  handle: string;
  weeks: (number | null)[];
  startDate: string;
  streak: number;
  best: number;
  total: number;
  asOf: string;
  stale: boolean;
}

interface Day {
  date: string;
  count: number;
  level: number;
}

export function githubHandle(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(/github\.com\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function isDay(value: unknown): value is Day {
  const d = value as Day;
  return (
    !!d &&
    typeof d.date === 'string' &&
    typeof d.count === 'number' &&
    typeof d.level === 'number'
  );
}

export async function readGithubActivity(
  links: { iconKey: string; href: string }[],
): Promise<GithubActivity | null> {
  const handle = githubHandle(links.find((l) => l.iconKey === 'github')?.href);
  if (!handle) return null;

  const now = new Date();
  const year = now.getUTCFullYear();

  const [profile, rows] = await Promise.all([
    prisma.githubProfile.findUnique({ where: { handle } }),
    prisma.githubYear.findMany({ where: { handle, year: { in: [year - 1, year] } } }),
  ]);
  if (!profile || rows.length === 0) return null;

  const timeline: (number | null)[] = [];
  for (const y of [year - 1, year]) {
    const row = rows.find((r) => r.year === y);
    timeline.push(
      ...(row ? decodeYear(row) : Array.from({ length: daysInYear(y) }, () => null)),
    );
  }
  const today = daysInYear(year - 1) + dayOfYear(now.toISOString().slice(0, 10));

  const observed = observedIndex(
    today,
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(
        profile.fetchedAt.getUTCFullYear(),
        profile.fetchedAt.getUTCMonth(),
        profile.fetchedAt.getUTCDate(),
      )) /
      86_400_000,
  );

  const weekday = now.getUTCDay();

  return {
    handle,
    weeks: buildWeeks(timeline, today, weekday, observed),
    startDate: new Date(Date.UTC(year - 1, 0, 1) + windowStart(today, weekday) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    streak: currentStreak(timeline, today, observed),
    best: bestStreak(timeline, today, observed),
    total: profile.total,
    asOf: profile.fetchedAt
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      .toLowerCase(),
    stale: now.getTime() - profile.fetchedAt.getTime() > REFRESH_AFTER_HOURS * 3_600_000,
  };
}

export async function refreshGithubActivity(handle: string): Promise<boolean> {
  let days: Day[];
  let total: number;

  try {
    const res = await fetch(`${API}/${encodeURIComponent(handle)}?y=last`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return false;

    const json = (await res.json()) as {
      total?: { lastYear?: number };
      contributions?: unknown[];
    };
    days = (json.contributions ?? []).filter(isDay);
    if (days.length < MIN_DAYS) return false;
    total = json.total?.lastYear ?? days.reduce((sum, d) => sum + d.count, 0);
  } catch {
    return false;
  }

  const byYear = new Map<number, Day[]>();
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    if (!Number.isInteger(year) || year < 2005 || year > 2200) continue;
    const list = byYear.get(year);
    if (list) list.push(day);
    else byYear.set(year, [day]);
  }
  if (byYear.size === 0) return false;

  try {
    const existing = await prisma.githubYear.findMany({
      where: { handle, year: { in: [...byYear.keys()] } },
    });

    const writes = [];
    for (const [year, entries] of byYear) {
      const data = mergeYear(existing.find((r) => r.year === year) ?? null, year, entries);
      writes.push(
        prisma.githubYear.upsert({
          where: { handle_year: { handle, year } },
          create: { handle, year, ...data },
          update: data,
        }),
      );
    }

    const snapshot = { total, fetchedAt: new Date() };
    writes.push(
      prisma.githubProfile.upsert({
        where: { handle },
        create: { handle, ...snapshot },
        update: snapshot,
      }),
    );

    await prisma.$transaction(writes);
    return true;
  } catch {
    return false;
  }
}
