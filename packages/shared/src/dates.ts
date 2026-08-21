/**
 * Everything stored and every aggregate is UTC. IST exists only at display
 * time, in the browser.
 *
 * The trap this file exists to close: aggregate in UTC but group the dashboard
 * by IST and every day boundary moves 5.5 hours, so a number computed one way
 * never reconciles with the same number computed the other and there is no
 * point at which the two agree. Storage in one timezone is the only version of
 * this that stays checkable.
 */

/** Midnight UTC for the given date. Strips the time entirely. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Midnight UTC of the following day. Use as an EXCLUSIVE upper bound. */
export function utcDayEnd(d: Date): Date {
  return new Date(utcDayStart(d).getTime() + 86_400_000);
}

/** Yesterday, midnight UTC. */
export function utcYesterday(now = new Date()): Date {
  return new Date(utcDayStart(now).getTime() - 86_400_000);
}

/**
 * "YYYY-MM-DD" in UTC — for keys and logs, never for display.
 *
 * 2026-08-21T23:30+05:30 is 18:00 UTC on the 21st, so this returns "2026-08-21"
 * and agrees with the IST date. Half an hour later it returns "2026-08-22"
 * while the visitor's clock still reads the 21st. That divergence is correct
 * and is exactly why nothing may print this string to a person.
 */
export function toDateKey(d: Date): string {
  return utcDayStart(d).toISOString().slice(0, 10);
}

/** Inclusive list of UTC day-starts between two dates. */
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
