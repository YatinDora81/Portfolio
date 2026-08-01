/**
 * Real commit activity for the contact section's GitHub row.
 *
 * The row draws the year as one line and a streak, so the numbers have to be
 * true — a decorative random curve would read as a claim about how much I
 * ship. GitHub's own counts are only exposed through the authenticated GraphQL
 * API, so this goes through a public, unauthenticated mirror.
 *
 * That mirror is one person's hobby service with no SLA, and it serves only a
 * TRAILING 365 days. Both facts push the same way: the site reads from Postgres
 * and the mirror only ever feeds it. A day not captured before it scrolls out of
 * that window is gone from the source forever, so the stored years are a
 * permanent archive rather than a cache — see GithubYear in the schema.
 *
 * Raw per-day COUNTS are stored, never the mirror's `level`, which is quantile
 * derived over its own sliding window and so reports the same day differently
 * from one month to the next. The daily window, the streaks and everything the
 * line smooths are recomputed at read time by ./github-codec, which is also why
 * they stay tunable.
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

/**
 * A response shorter than this is treated as garbage rather than as a thin year.
 * `isDay` runs as a filter, so a truncated payload arrives looking structurally
 * perfect — only the length gives it away, and merging one would blank out every
 * day it failed to mention.
 */
const MIN_DAYS = 300;

/**
 * How old the stored snapshot has to be before a render bothers polling again.
 * Under the page's own 24h revalidate, so a daily render always refreshes, but
 * high enough that a burst of revalidations makes one request rather than many.
 */
const REFRESH_AFTER_HOURS = 20;

export interface GithubActivity {
  handle: string;
  /**
   * One total per week for the last WEEKS weeks, oldest first — the line reads
   * the year at the week, which is calm on purpose. Always starts on a Sunday;
   * `null` marks a week the archive cannot vouch for and so does not draw.
   */
  weeks: (number | null)[];
  /**
   * The UTC date of the Sunday that opens weeks[0], as "YYYY-MM-DD", and the
   * only date on the wire: the scrub names its week by index arithmetic off this
   * one, so 53 date strings never cross the network.
   */
  startDate: string;
  /** Consecutive days with at least one contribution, ending today. */
  streak: number;
  /** Longest such run in the past year. */
  best: number;
  /** Contributions in the past year. */
  total: number;
  /** When the numbers above were captured, e.g. "jul 24". The caption prints it. */
  asOf: string;
  /**
   * Whether the snapshot is old enough to be worth polling for again. A flag
   * rather than the raw timestamp so the render payload carries one bit and the
   * refresh policy stays in one place.
   */
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
  // No profile means no refresh has ever succeeded, and no rows means the archive
  // can't cover the window. Either way the row drops the line rather than
  // drawing an empty year that would read as "he shipped nothing".
  if (!profile || rows.length === 0) return null;

  // A streak or a year-wide window can reach back across New Year, so the two rows
  // are laid end to end into one continuous timeline starting Jan 1 of last year.
  // A year with no row contributes NULLS of the right length: it keeps every index
  // below aligned whether or not it was ever captured, and — unlike the zeros this
  // used to pad with — it says the archive never saw those days rather than
  // claiming a year of shipping nothing. On a fresh handle, where last year's row
  // doesn't exist yet, that is the difference between a line that starts where the
  // archive does and a flat floor running back to January.
  const timeline: (number | null)[] = [];
  for (const y of [year - 1, year]) {
    const row = rows.find((r) => r.year === y);
    timeline.push(
      ...(row ? decodeYear(row) : Array.from({ length: daysInYear(y) }, () => null)),
    );
  }
  const today = daysInYear(year - 1) + dayOfYear(now.toISOString().slice(0, 10));

  // Where the archive stops being able to speak. Past this the stored '0's only
  // mean "never fetched", so they are left undrawn and out of both streaks
  // rather than counted as days with nothing shipped.
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
    // Both the array and this label read the window's first index from the same
    // `windowStart`, and both count from the timeline's own origin — Jan 1 of
    // last year, the day `today` is itself measured from — so weeks[0] and
    // startDate cannot come to name different Sundays.
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

/**
 * Pulls the trailing year and merges it into the archive day by day, keyed on the
 * absolute date.
 *
 * Returns false on every failure — offline, rate-limited, renamed account, short
 * payload — having written nothing at all. `fetchedAt` advances only on the way
 * out, so the tile's "as of" label can never claim to be newer than its data.
 */
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
    // Bounded to the same range as GithubYear_year_check. One nonsense date in
    // the response would otherwise reach the upsert, and because every year is
    // written in a single transaction, that CHECK violation would roll back the
    // good years too — a refresh that fails completely, silently, and for as
    // long as upstream keeps sending the bad row.
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
    // Swallowed because the caller is usually `after()`, where a rejection is
    // logged and dropped anyway. The transaction means a failure here wrote
    // nothing, so the archive is still whatever it was.
    return false;
  }
}
