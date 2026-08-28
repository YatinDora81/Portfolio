import type { ContentStatus } from "db";

// declared order, not alphabetical: this drives the filter tabs
export const CONTENT_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

export const STATUS_LABEL: Record<ContentStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export const STATUS_NOTE: Record<ContentStatus, string> = {
  DRAFT: "Exists only in here. Not reachable on the site, and not counted by anything the site derives.",
  SCHEDULED: "Goes live by itself at the time below. Until then it behaves exactly like a draft.",
  PUBLISHED: "Live to visitors right now.",
  ARCHIVED: "Retired. Off the site, and deliberately left out of preview too — a preview link will not bring it back.",
};

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === "string" && (CONTENT_STATUSES as readonly string[]).includes(value);
}

export function statusChip(status: ContentStatus): string {
  return `chip st-${status.toLowerCase()}`;
}

// IST is UTC+05:30 year-round
const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * MINUTE_MS;

export const IST_ZONE = "Asia/Kolkata";

export function istInputToUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  // Date.UTC silently rolls 31 February over into March
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
  if (Number.isNaN(utcMs)) return null;

  const when = new Date(utcMs);
  return utcToIstInput(when) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? when : null;
}

export function utcToIstInput(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

const istFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_ZONE,
  day: "2-digit", month: "short", year: "numeric",
  hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});

export function istLabel(instant: Date): string {
  return `${istFormat.format(instant)} IST`;
}

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
    return { ok: true, status: rawStatus, publishAt: null };
  }

  const when = typeof rawPublishAtIst === "string" ? istInputToUtc(rawPublishAtIst) : null;
  if (!when) return { ok: false, error: "Scheduled needs a date and time. Nothing was saved." };

  if (when.getTime() <= now) {
    return {
      ok: false,
      error: "That time has already passed. Pick one in the future, or set the status to Published.",
    };
  }

  return { ok: true, status: rawStatus, publishAt: when };
}

export function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}
