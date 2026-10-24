import type { BuildState, ContentStatus, MilestoneState } from "db";

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

export function monthInputToUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;

  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;

  return new Date(Date.UTC(Number(m[1]), month - 1, 1));
}

export function utcToMonthInput(instant: Date): string {
  return instant.toISOString().slice(0, 7);
}

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short", year: "numeric",
});

export function monthLabel(instant: Date): string {
  return monthFormat.format(instant);
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

export const BUILD_STATES = ["SHIPPED", "BUILDING", "PAUSED"] as const;

export const MILESTONE_STATES = ["DONE", "DOING", "NEXT"] as const;

export const BUILD_LABEL: Record<BuildState, string> = {
  SHIPPED: "Shipped",
  BUILDING: "Building",
  PAUSED: "Paused",
};

export const BUILD_SUB: Record<BuildState, string> = {
  SHIPPED: "default",
  BUILDING: "in flight",
  PAUSED: "honest stop",
};

export const BUILD_NOTE: Record<BuildState, string> = {
  SHIPPED:
    "The row renders as it does today — green dot, live link, latency on the prod tab, highlights in the fold. Nothing below this is read, and nothing below this is deleted either.",
  BUILDING:
    "The cover becomes the working drawing, the dot turns amber, the live link and the health probe both stand down. The domain still prints — that is the plan — but nothing links to it.",
  PAUSED:
    "Still on the site and still honest, with no momentum claimed. The amber drains to grey, the ping stops, and the eta is dropped rather than shown slipped.",
};

export const MILESTONE_CAP = 3;

export const MILESTONE_LABEL_MAX = 10;

export const ETA_MAX = 24;

export const BUILD_VERSION_MAX = 16;

export const BUILD_STALE_DAYS = 90;

export const BUILD_NAG_DAYS = 45;

export function isBuildState(value: unknown): value is BuildState {
  return typeof value === "string" && (BUILD_STATES as readonly string[]).includes(value);
}

export function isMilestoneState(value: unknown): value is MilestoneState {
  return typeof value === "string" && (MILESTONE_STATES as readonly string[]).includes(value);
}

export interface MilestoneRow {
  id?: string;
  label: string;
  state: MilestoneState;
  sortOrder: number;
}

export type ResolvedBuild =
  | {
      ok: true;
      buildState: BuildState;
      buildVersion: string | null;
      etaLabel: string | null;
      milestones: MilestoneRow[];
    }
  | { ok: false; error: string };

export function resolveBuild(
  rawState: unknown,
  rawVersion: unknown,
  rawEta: unknown,
  rawMilestones: unknown
): ResolvedBuild {
  if (!isBuildState(rawState)) {
    return {
      ok: false,
      error: `The build state did not arrive (got ${JSON.stringify(rawState)}), so nothing was saved.`,
    };
  }

  const version = typeof rawVersion === "string" ? rawVersion.trim() : "";
  if (version.length > BUILD_VERSION_MAX) {
    return {
      ok: false,
      error: `The version prints on a corner tab, so it has to stay under ${BUILD_VERSION_MAX} characters. Nothing was saved.`,
    };
  }

  const eta = typeof rawEta === "string" ? rawEta.trim() : "";
  if (eta.length > ETA_MAX) {
    return {
      ok: false,
      error: `The eta has to fit ${ETA_MAX} characters. Nothing was saved.`,
    };
  }
  if (eta && !Number.isNaN(Date.parse(eta))) {
    return {
      ok: false,
      error: `"${eta}" reads as a date. Write it as prose — "shipping ~ Nov" — so a slip shows as neglect rather than as a lie. Nothing was saved.`,
    };
  }

  if (!Array.isArray(rawMilestones)) {
    return { ok: false, error: "The milestone rows did not arrive, so nothing was saved." };
  }

  const milestones: MilestoneRow[] = [];
  for (const raw of rawMilestones) {
    const row = raw as { id?: unknown; label?: unknown; state?: unknown };
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    if (label.length > MILESTONE_LABEL_MAX) {
      return {
        ok: false,
        error: `"${label}" is ${label.length} characters. A pane label clips past ${MILESTONE_LABEL_MAX}, so nothing was saved.`,
      };
    }
    if (!isMilestoneState(row.state)) {
      return {
        ok: false,
        error: `"${label}" has no usable state (got ${JSON.stringify(row.state)}), so nothing was saved.`,
      };
    }
    milestones.push({
      ...(typeof row.id === "string" && row.id ? { id: row.id } : {}),
      label,
      state: row.state,
      sortOrder: milestones.length,
    });
  }

  if (milestones.length > MILESTONE_CAP) {
    return {
      ok: false,
      error: `The cover draws ${MILESTONE_CAP} panes, so a ${MILESTONE_CAP + 1}th milestone would be stored and never shown. Nothing was saved.`,
    };
  }

  return {
    ok: true,
    buildState: rawState,
    buildVersion: version || null,
    etaLabel: eta || null,
    milestones,
  };
}

export function buildWarning(
  buildState: BuildState,
  milestones: { label: string; state: MilestoneState }[]
): string | null {
  if (buildState === "SHIPPED") return null;
  const doing = milestones.filter((m) => m.state === "DOING");
  if (!milestones.length) {
    return "No milestones, so the cover draws an empty shell. It is still honest — it just says nothing about how far the build got.";
  }
  if (doing.length > 1) {
    return `${doing.length} milestones are marked doing. The dimension line names one surface, so it names none of them instead.`;
  }
  if (!doing.length && buildState === "BUILDING") {
    return "Nothing is marked doing, so the drawing has no amber pane and the caption under it stays blank. That is the honest signal for Paused — on Building it usually means a milestone needs flipping.";
  }
  return null;
}

export function daysSince(instant: Date, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - instant.getTime()) / 86_400_000));
}
