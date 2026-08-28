// 53 covers any year plus the partial week it starts on
export const WEEKS = 53;

export function windowStart(today: number, weekday: number): number {
  return today - ((WEEKS - 1) * 7 + weekday);
}

// index is the count
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

export function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return -1;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000);
}

function encodeCount(count: number): string {
  const n = Math.min(Math.max(0, Math.trunc(count)), MAX_ENCODED);
  return ALPHABET[n] ?? '0';
}

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

export function mergeYear(
  previous: StoredYear | null,
  year: number,
  entries: { date: string; count: number }[],
): StoredYear {
  const length = daysInYear(year);
  const chars =
    previous && previous.days.length === length
      ? previous.days.split('')
      : Array.from({ length }, () => '0');
  const spikes = previous ? parseSpikes(previous.spikes) : new Map<number, number>();

  for (const entry of entries) {
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

export function observedIndex(today: number, daysSinceFetch: number): number {
  return Math.min(today, today - Math.max(0, Math.floor(daysSinceFetch)));
}

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
      if (count == null || i > observedThrough) continue;
      sum += count;
      known = true;
    }
    weeks.push(known ? sum : null);
  }
  return weeks;
}

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
