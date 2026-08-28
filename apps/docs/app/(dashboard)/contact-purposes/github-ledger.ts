import { prisma } from "db";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

// covers any year plus the partial week it starts on
const WEEKS = 53;

// the site refreshes at most this often
const REFRESH_AFTER_HOURS = 20;

export interface GithubLedger {
  handle: string;
  weeks: (number | null)[];
  startDate: string;
  total: number;
  streak: number;
  best: number;
  fetchedAt: Date;
  stale: boolean;
}

function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return -1;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000);
}

function windowStart(today: number, weekday: number): number {
  return today - ((WEEKS - 1) * 7 + weekday);
}

function parseSpikes(raw: string): Map<number, number> {
  const spikes = new Map<number, number>();
  for (const pair of raw.split(",")) {
    if (!pair) continue;
    const [index, count] = pair.split(":").map(Number);
    if (Number.isInteger(index) && Number.isInteger(count)) spikes.set(index!, count!);
  }
  return spikes;
}

function decodeYear(stored: { days: string; spikes: string }): number[] {
  const counts = Array.from(stored.days, (char) => {
    const value = ALPHABET.indexOf(char);
    return value < 0 ? 0 : value;
  });
  for (const [index, count] of parseSpikes(stored.spikes)) {
    if (index >= 0 && index < counts.length) counts[index] = count;
  }
  return counts;
}

function observedIndex(today: number, daysSinceFetch: number): number {
  return Math.min(today, today - Math.max(0, Math.floor(daysSinceFetch)));
}

export function githubHandle(href: string | null | undefined): string | null {
  if (!href) return null;
  return href.match(/github\.com\/([^/?#]+)/i)?.[1] ?? null;
}

export async function readGithubLedger(
  links: { iconKey: string; href: string }[],
): Promise<GithubLedger | null> {
  const handle = githubHandle(links.find((l) => l.iconKey === "github")?.href);
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
    timeline.push(...(row ? decodeYear(row) : Array.from({ length: daysInYear(y) }, () => null)));
  }

  const today = daysInYear(year - 1) + dayOfYear(now.toISOString().slice(0, 10));
  const weekday = now.getUTCDay();
  const observed = observedIndex(
    today,
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(
        profile.fetchedAt.getUTCFullYear(),
        profile.fetchedAt.getUTCMonth(),
        profile.fetchedAt.getUTCDate(),
      )) / 86_400_000,
  );

  const start = windowStart(today, weekday);
  const weeks: (number | null)[] = [];
  for (let w = 0; w < WEEKS; w++) {
    let sum = 0;
    let known = false;
    for (let d = 0; d < 7; d++) {
      const i = start + w * 7 + d;
      const count = timeline[i];
      if (count == null || i > observed) continue;
      sum += count;
      known = true;
    }
    weeks.push(known ? sum : null);
  }

  let i = Math.min(today, observed);
  if ((timeline[i] ?? 0) === 0) i--;
  let streak = 0;
  for (; i >= 0 && (timeline[i] ?? 0) > 0; i--) streak++;

  let best = 0;
  let run = 0;
  for (let j = Math.max(0, today - 364); j <= Math.min(today, observed); j++) {
    run = (timeline[j] ?? 0) > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }

  return {
    handle,
    weeks,
    startDate: new Date(Date.UTC(year - 1, 0, 1) + start * 86_400_000).toISOString().slice(0, 10),
    total: profile.total,
    streak,
    best,
    fetchedAt: profile.fetchedAt,
    stale: now.getTime() - profile.fetchedAt.getTime() > REFRESH_AFTER_HOURS * 3_600_000,
  };
}
