export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Exclusive upper bound. */
export function utcDayEnd(d: Date): Date {
  return new Date(utcDayStart(d).getTime() + 86_400_000);
}

export function utcYesterday(now = new Date()): Date {
  return new Date(utcDayStart(now).getTime() - 86_400_000);
}

export function toDateKey(d: Date): string {
  return utcDayStart(d).toISOString().slice(0, 10);
}

const MONTH_WORDS = [
  /\bjan(uary)?\b/i, /\bfeb(ruary)?\b/i, /\bmar(ch)?\b/i, /\bapr(il)?\b/i,
  /\bmay\b/i, /\bjun(e)?\b/i, /\bjul(y)?\b/i, /\baug(ust)?\b/i,
  /\bsept?(ember)?\b/i, /\boct(ober)?\b/i, /\bnov(ember)?\b/i, /\bdec(ember)?\b/i,
];

/** Null once the month the label names, read forward from `anchor`, has ended. */
export function livingEta(label: string | null, anchor: Date, now: Date): string | null {
  if (!label) return null;

  let named = -1;
  let at = -1;
  for (let month = 0; month < MONTH_WORDS.length; month += 1) {
    const hit = MONTH_WORDS[month]!.exec(label);
    if (hit && hit.index > at) {
      at = hit.index;
      named = month;
    }
  }
  if (named < 0) return label;

  const year = anchor.getUTCFullYear() + (named < anchor.getUTCMonth() ? 1 : 0);
  return now.getTime() < Date.UTC(year, named + 1, 1) ? label : null;
}

/** Inclusive of both ends. */
export function eachUtcDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const end = utcDayStart(to);
  let cur = utcDayStart(from);
  while (cur <= end) {
    days.push(cur);
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return days;
}
