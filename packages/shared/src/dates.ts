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

/** UTC — for keys and logs, never for display: it can differ from the viewer's date. */
export function toDateKey(d: Date): string {
  return utcDayStart(d).toISOString().slice(0, 10);
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
