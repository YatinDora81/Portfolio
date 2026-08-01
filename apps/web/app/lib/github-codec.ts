/**
 * The stored format of the contribution archive, and the calendar arithmetic
 * that reads it. Everything here is pure — no database, no network — because the
 * off-by-ones live in this half and they are far easier to reason about, and to
 * check, on their own.
 *
 * See GithubYear in the schema for why a calendar year and not a sliding window.
 */

/** Points on the line. A full year, the way GitHub counts its own — 53 covers
    any year plus the partial week it starts on. The timeline it slices has
    always held two calendar years, so the window costs nothing but the indices
    it reads. Weeks before the archive starts come back null and are simply not
    drawn, so an early-January render begins mid-panel rather than at a zero. */
export const WEEKS = 53;

/** How many days back the window opens, given the weekday `today` falls on.
    Shared by `buildWeeks` and by whatever needs to name the window's first day —
    they must not each do this arithmetic and drift. */
export function windowStart(today: number, weekday: number): number {
  return today - ((WEEKS - 1) * 7 + weekday);
}

/**
 * Index is the count, so a stored year reads as `000310021045000…` in psql and
 * needs no decoder to skim. Digits come first deliberately: almost every day
 * lands in 0–9, and the letters only carry the tail.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const MAX_ENCODED = ALPHABET.length - 1;

export interface StoredYear {
  days: string;
  spikes: string;
}

export function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 366 : 365;
}

/** `"2026-03-01"` → 59, or 60 in a leap year. Index 0 is January 1. */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return -1;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000);
}

function encodeCount(count: number): string {
  const n = Math.min(Math.max(0, Math.trunc(count)), MAX_ENCODED);
  return ALPHABET[n] ?? '0';
}

/** `"87:112,203:99"` → the exact counts for days a single character can't hold. */
function parseSpikes(raw: string): Map<number, number> {
  const spikes = new Map<number, number>();
  for (const pair of raw.split(',')) {
    if (!pair) continue;
    const [index, count] = pair.split(':').map(Number);
    if (Number.isInteger(index) && Number.isInteger(count)) spikes.set(index!, count!);
  }
  return spikes;
}

function formatSpikes(spikes: Map<number, number>): string {
  return [...spikes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, count]) => `${index}:${count}`)
    .join(',');
}

export function decodeYear(stored: StoredYear): number[] {
  const counts = Array.from(stored.days, (char) => {
    const value = ALPHABET.indexOf(char);
    return value < 0 ? 0 : value;
  });
  for (const [index, count] of parseSpikes(stored.spikes)) {
    if (index >= 0 && index < counts.length) counts[index] = count;
  }
  return counts;
}

/**
 * Writes one year's worth of fetched days over whatever is already stored, by
 * absolute date. Days the fetch didn't mention keep their stored value — that is
 * what lets an outage heal on the next success instead of blanking the gap, and
 * what keeps years that have scrolled out of the mirror's window untouched.
 */
export function mergeYear(
  previous: StoredYear | null,
  year: number,
  entries: { date: string; count: number }[],
): StoredYear {
  const length = daysInYear(year);
  // A stored row of the wrong length can't be indexed by day-of-year, so it is
  // rebuilt from scratch rather than patched into something worse.
  const chars =
    previous && previous.days.length === length
      ? previous.days.split('')
      : Array.from({ length }, () => '0');
  const spikes = previous ? parseSpikes(previous.spikes) : new Map<number, number>();

  for (const entry of entries) {
    // The year is checked, not just the index: every day-of-year in one year is
    // also a valid index in the next, so a stray date would land silently on the
    // wrong day rather than being rejected.
    if (Number(entry.date.slice(0, 4)) !== year) continue;
    const index = dayOfYear(entry.date);
    if (index < 0 || index >= length) continue;
    const count = Math.max(0, Math.trunc(entry.count));
    chars[index] = encodeCount(count);
    if (count > MAX_ENCODED) spikes.set(index, count);
    else spikes.delete(index);
  }

  return { days: chars.join(''), spikes: formatSpikes(spikes) };
}

/**
 * A stored '0' means two different things — "no contributions that day" and
 * "that day was never fetched" — and the difference matters past the last
 * refresh. `observedThrough` is the index of the most recent day the archive has
 * actually seen, so everything after it is treated as unknown rather than empty.
 * Without it a two-day-old snapshot reads as two zero days, which silently
 * collapses a live streak to nothing.
 */
export function observedIndex(today: number, daysSinceFetch: number): number {
  return Math.min(today, today - Math.max(0, Math.floor(daysSinceFetch)));
}

/**
 * One entry per week over the trailing window, oldest first, each the sum of
 * that week's contributions. Walked back to the Sunday that opens the first
 * column so a point is always a whole calendar week; the last one is the current
 * week and is short by however many days are still to come.
 *
 * `null` marks a week the archive cannot vouch for — every day in it falls
 * before the first stored year or after the last refresh — so the line starts
 * and ends where the archive does, rather than diving to a zero that would read
 * as "shipped nothing". A week the archive only partly covers is the sum of the
 * days it does hold: that is a floor, and a floor is still true.
 */
export function buildWeeks(
  timeline: (number | null)[],
  today: number,
  weekday: number,
  observedThrough: number = today,
): (number | null)[] {
  const weeks: (number | null)[] = [];
  const start = windowStart(today, weekday);
  for (let w = 0; w < WEEKS; w++) {
    let sum = 0;
    let known = false;
    for (let d = 0; d < 7; d++) {
      const i = start + w * 7 + d;
      const count = timeline[i];
      // The tail of the last column runs past today, which no observedThrough
      // can reach — that is what keeps the current week short instead of
      // padding it with days that haven't happened.
      if (count == null || i > observedThrough) continue;
      sum += count;
      known = true;
    }
    weeks.push(known ? sum : null);
  }
  return weeks;
}

/**
 * Trailing run of active days, counted back from the last day the archive has
 * seen. That day counts as neutral rather than as a break: a 9am render — or one
 * taken before the day's commits were fetched — shouldn't report a live streak
 * as broken.
 *
 * An unknown day ends the run, same as an empty one. Both are honest here: a
 * streak is a claim, and one that walked through days nobody ever fetched would
 * be inventing the part it can't see.
 */
export function currentStreak(
  timeline: (number | null)[],
  today: number,
  observedThrough: number = today,
): number {
  let i = Math.min(today, observedThrough);
  if ((timeline[i] ?? 0) === 0) i--;
  let streak = 0;
  for (; i >= 0 && (timeline[i] ?? 0) > 0; i--) streak++;
  return streak;
}

/** Longest run in the trailing 365 days, ignoring days not yet observed. */
export function bestStreak(
  timeline: (number | null)[],
  today: number,
  observedThrough: number = today,
): number {
  let best = 0;
  let run = 0;
  for (let i = Math.max(0, today - 364); i <= Math.min(today, observedThrough); i++) {
    run = (timeline[i] ?? 0) > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
