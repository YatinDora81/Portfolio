import type { ContentStatus } from "db";

/**
 * The vocabulary the lifecycle UI shares: the four states, how they are named
 * on screen, and the two timezone conversions that stand between a picker and
 * the database.
 *
 * No `server-only`, and no import that pulls one in: the form components run in
 * the browser and the actions run on the server, and both of them have to agree
 * on what "10:30" means. A second copy of `istInputToUtc` living on one side is
 * exactly how a scheduled post ends up 5.5 hours out.
 */

/**
 * Declared order, not alphabetical — this array drives both the filter tabs and
 * the selector, and a lifecycle listed A-D-P-S stops reading as a lifecycle.
 */
export const CONTENT_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

export const STATUS_LABEL: Record<ContentStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/** The consequence of each state, in the admin's terms rather than the enum's. */
export const STATUS_NOTE: Record<ContentStatus, string> = {
  DRAFT: "Exists only in here. Not reachable on the site, and not counted by anything the site derives.",
  SCHEDULED: "Goes live by itself at the time below. Until then it behaves exactly like a draft.",
  PUBLISHED: "Live to visitors right now.",
  ARCHIVED: "Retired. Off the site, and deliberately left out of preview too — a preview link will not bring it back.",
};

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === "string" && (CONTENT_STATUSES as readonly string[]).includes(value);
}

/** The `.chip` modifier for a status. Four hues, one per state — see the CSS. */
export function statusChip(status: ContentStatus): string {
  return `chip st-${status.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// IST ⇄ UTC
//
// Everything in the database is UTC. The only person who reads this admin reads
// IST. `<input type="datetime-local">` sits between them and hands back a bare
// "YYYY-MM-DDTHH:mm" with no zone attached at all, so the zone is not something
// the platform supplies — it is a decision, made here, once, in both directions.
//
// IST is UTC+05:30 year-round: no DST, no historical shift inside any window an
// editorial calendar reaches. That fixed offset is what lets these be
// arithmetic instead of a timezone-database lookup.
// ---------------------------------------------------------------------------

const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * MINUTE_MS;

export const IST_ZONE = "Asia/Kolkata";

/**
 * Picker string → the instant it names. **IST in, UTC out.**
 *
 * `new Date("2026-09-01T10:30")` is the trap: with no zone in the string, the
 * runtime resolves it in *its own* zone, so the same keystrokes would store a
 * different instant depending on where the browser is. Building the value
 * through `Date.UTC` and then subtracting IST's offset is zone-independent —
 * the arithmetic is identical on a laptop in Bengaluru, on Vercel's UTC boxes,
 * and in CI.
 *
 * Returns null on anything that is not a complete, in-range date and time, so
 * a caller has to deal with the failure rather than inherit a NaN.
 */
export function istInputToUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  // Range-checked before `Date.UTC`, which silently rolls 31 February over into
  // March rather than refusing it. A hand-built POST is the only way to get
  // here with one, and it should be a rejection, not a date nobody chose.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
  if (Number.isNaN(utcMs)) return null;

  const when = new Date(utcMs);
  // Round-trip guard for the rollovers the range check cannot see (31 Apr, 29
  // Feb in a common year): if reformatting does not give back what was typed,
  // the date did not exist.
  return utcToIstInput(when) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? when : null;
}

/**
 * Stored instant → the picker string. **UTC in, IST out.**
 *
 * Shift the instant forward by IST's offset, then read the UTC fields: the
 * shifted clock's UTC face *is* the IST wall clock. `toISOString` rather than
 * any `toLocale*` call, because it is the one formatter that never consults the
 * runtime's zone — which is what keeps the server's HTML and the browser's
 * hydration byte-identical for a value that is rendered into an attribute.
 */
export function utcToIstInput(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * The zone is named, so both render passes emit the same characters — the same
 * reason the revalidation page formats its stamps this way instead of calling
 * `toLocaleString()` inside a client component.
 */
const istFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_ZONE,
  day: "2-digit", month: "short", year: "numeric",
  hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});

export function istLabel(instant: Date): string {
  return `${istFormat.format(instant)} IST`;
}

/**
 * The one rule a scheduled item has to satisfy, phrased for a human. Shared by
 * the form (before the round trip) and the actions (which never trust it).
 */
export function scheduleProblem(
  status: ContentStatus,
  publishAtIst: string,
  now: number = Date.now()
): string | null {
  if (status !== "SCHEDULED") return null;
  if (!publishAtIst.trim()) return "Scheduled needs a date and time.";
  const when = istInputToUtc(publishAtIst);
  if (!when) return "That is not a date and time this can read.";
  if (when.getTime() <= now) {
    return "That time has already passed. Pick one in the future, or set the status to Published.";
  }
  return null;
}

export type ResolvedLifecycle =
  | { ok: true; status: ContentStatus; publishAt: Date | null }
  | { ok: false; error: string };

/**
 * The lifecycle half of a save, parsed and checked on the server. Both actions
 * go through this so a blog and a project cannot disagree about what a status
 * means or when a schedule is valid.
 *
 * It **refuses** a status it does not recognise rather than defaulting to one,
 * and that is the whole point of the function. The column this replaces was
 * read as `formData.get("show") === "true"`: strict equality against a field
 * that might not arrive, so a renamed or absent input meant `false` — every
 * save silently un-published the post, looked like a success, and said nothing.
 * A status that did not arrive is a bug in the form, and a bug in the form must
 * not be able to publish or un-publish anything.
 *
 * A refusal is returned rather than thrown because a `throw` inside a server
 * action is replaced by an opaque digest in a production build — the one
 * sentence the admin needs would be the one thing they never see.
 */
export function resolveLifecycle(
  rawStatus: unknown,
  rawPublishAtIst: unknown,
  now: number = Date.now()
): ResolvedLifecycle {
  if (!isContentStatus(rawStatus)) {
    return {
      ok: false,
      error: `The status field did not arrive (got ${JSON.stringify(rawStatus)}), so nothing was saved.`,
    };
  }

  if (rawStatus !== "SCHEDULED") {
    // Cleared on purpose. A `publishAt` left behind on a draft is a trap for
    // later: the sweep looks for SCHEDULED rows whose time has passed, so a row
    // moved back to SCHEDULED months on would arrive already overdue and go
    // live the instant anyone loaded an admin page.
    return { ok: true, status: rawStatus, publishAt: null };
  }

  // IST in, UTC out. The field carries its zone in its NAME because the value
  // has none — `<input type="datetime-local">` yields a bare wall clock, and
  // reading it with `new Date()` here would resolve it in the *server's* zone.
  const when = typeof rawPublishAtIst === "string" ? istInputToUtc(rawPublishAtIst) : null;
  if (!when) return { ok: false, error: "Scheduled needs a date and time. Nothing was saved." };

  // Re-checked here even though the form checks it too: the form's copy is a
  // courtesy, this one is the rule.
  if (when.getTime() <= now) {
    return {
      ok: false,
      error: "That time has already passed. Pick one in the future, or set the status to Published.",
    };
  }

  return { ok: true, status: rawStatus, publishAt: when };
}

/**
 * What went wrong when the action itself rejected — the network gone, or the
 * case this admin will actually meet, an expired session bouncing the action
 * POST to /login. Same shape as the flags page's `transportError`, for the same
 * reason: a throw inside a transition reaches no error boundary, so the only
 * place it can be reported is the call site that caught it.
 */
export function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}
