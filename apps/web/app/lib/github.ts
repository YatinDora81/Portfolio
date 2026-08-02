/**
 * Real commit activity for the contact section's GitHub row.
 *
 * The mirror is an unauthenticated hobby service serving only a trailing 365
 * days, so the site reads from Postgres and the mirror only ever feeds it: a day
 * not captured before it scrolls out is gone from the source forever.
 *
 * Raw per-day counts are stored, never the mirror's `level` — that is quantile
 * derived over its own window and reports the same day differently month to
 * month.
 */

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

/** `isDay` is a filter, so a truncated payload looks structurally perfect and
    only the length gives it away. Merging one would blank every day it omits. */
const MIN_DAYS = 300;

/** Under the page's 24h revalidate, so a daily render refreshes — but high
    enough that a burst of revalidations makes one request, not many. */
const REFRESH_AFTER_HOURS = 20;

export interface GithubActivity {
  handle: string;
  /** Weekly totals, oldest first, always starting on a Sunday. `null` marks a
      week the archive cannot vouch for and so does not draw. */
  weeks: (number | null)[];
  /** UTC date of weeks[0]'s Sunday — the only date on the wire, so 53 date
      strings never cross the network. */
  startDate: string;
  /** Consecutive days with at least one contribution, ending today. */
  streak: number;
  /** Longest such run in the past year. */
  best: number;
  /** Contributions in the past year. */
  total: number;
  /** When the numbers above were captured, e.g. "jul 24". The caption prints it. */
  asOf: string;
  /** A flag, not the timestamp, so the payload carries one bit and the refresh
      policy stays in one place. */
  stale: boolean;
}

interface Day {
  date: string;
  count: number;
  level: number;
}

/** `https://github.com/YatinDora81` → `YatinDora81`. */
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
  // Drop the line rather than draw an empty year that reads as "shipped nothing".
  if (!profile || rows.length === 0) return null;

  // Two rows laid end to end, because a streak can reach back across New Year.
  // A missing year contributes NULLS, not zeros: it keeps the indices aligned
  // while still saying the archive never saw those days.
  const timeline: (number | null)[] = [];
  for (const y of [year - 1, year]) {
    const row = rows.find((r) => r.year === y);
    timeline.push(
      ...(row ? decodeYear(row) : Array.from({ length: daysInYear(y) }, () => null)),
    );
  }
  const today = daysInYear(year - 1) + dayOfYear(now.toISOString().slice(0, 10));

  // Where the archive stops being able to speak: past this a stored '0' only
  // means "never fetched".
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
    // Same `windowStart` and same origin as the array, so weeks[0] and this
    // label cannot come to name different Sundays.
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

/** Merges the trailing year into the archive by absolute date. Returns false on
    every failure having written nothing; `fetchedAt` advances only on the way
    out, so "as of" can never claim to be newer than its data. */
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
    // Bounded to GithubYear_year_check: one nonsense date reaching the upsert
    // would fail the whole transaction and roll back the good years too.
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

    // One transaction so the timestamp can't land without the years it describes.
    await prisma.$transaction(writes);
    return true;
  } catch {
    // The transaction means a failure here wrote nothing.
    return false;
  }
}
