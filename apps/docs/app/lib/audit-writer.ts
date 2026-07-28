import { prisma } from "db";
import type { AuditActor, AuditDraft } from "@/lib/audit";
import { draft } from "@/lib/audit";

/**
 * The half of the audit log that touches the database.
 *
 * Deliberately NOT a `"use server"` module: nothing here is callable from a
 * browser. It is imported by the actions that already authenticate, and the
 * audit row is written inside their transaction so history and data commit or
 * roll back together — a rejected save leaves no entry claiming it happened.
 */

/** The Prisma client inside an interactive `$transaction`, or the plain one. */
type Db = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$use" | "$extends" | "$transaction">;

type Session = { userId: string; email: string; role: string };

/**
 * Who to record. The JWT carries no display name, so the account is read once
 * per event; if it has since been deleted the email's local part stands in,
 * because an entry that cannot name its actor is worse than a slightly rough
 * one. Denormalised onto the event so it survives that account's deletion.
 */
export async function resolveActor(db: Db, session: Session): Promise<AuditActor> {
  const row = await db.adminUser.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true },
  });
  return {
    userId: session.userId,
    name: row?.name || session.email.split("@")[0] || "unknown",
    email: row?.email || session.email,
    role: session.role,
  };
}

/**
 * Writes the draft. Returns the event id so a publish that follows can be
 * recorded against the same gesture instead of appearing as a second one.
 *
 * An empty draft writes nothing at all: a save that changed no field is not an
 * event, and a log full of "0 changes" rows is a log nobody reads.
 */
export async function commitAudit(db: Db, d: AuditDraft): Promise<string | null> {
  if (d.isEmpty && d.action !== "PUBLISH") return null;

  const event = await db.auditEvent.create({
    data: {
      action: d.action,
      surface: d.surface,
      actorId: d.actor.userId,
      actorName: d.actor.name,
      actorEmail: d.actor.email,
      actorRole: d.actor.role,
      changeCount: d.changes.length,
      summary: d.summary,
    },
    select: { id: true },
  });

  if (d.changes.length > 0) {
    await db.auditChange.createMany({
      data: d.changes.map((c) => ({ ...c, eventId: event.id })),
    });
  }
  return event.id;
}

/**
 * Records the outcome of a publish.
 *
 * With an `eventId` it patches the save it belongs to, so one Save & Publish is
 * one entry that can honestly read "saved, publish failed" — the save is not
 * rolled back when the second hop fails, and the log must not pretend either
 * that it succeeded or that the save didn't happen.
 *
 * Without one it is a bare Publish, which gets its own entry with no changes.
 *
 * Best-effort by design: this runs AFTER the save transaction has committed, so
 * throwing here would report a failure for work that actually landed.
 */
export async function recordPublish(
  session: Session,
  eventId: string | undefined,
  result: { ok: boolean; error?: string }
): Promise<void> {
  try {
    const state = result.ok ? "OK" : "FAILED";
    if (eventId) {
      // Scoped to the actor and to a still-pending event: an id from a hostile
      // caller cannot overwrite somebody else's history, and a retry cannot
      // rewrite an outcome that was already recorded.
      await prisma.auditEvent.updateMany({
        where: { id: eventId, actorId: session.userId, publishState: "NONE" },
        data: {
          publishState: state,
          publishedAt: result.ok ? new Date() : null,
          publishError: result.error ?? null,
        },
      });
      return;
    }
    const actor = await resolveActor(prisma, session);
    const d = draft("PUBLISH", "publish", actor);
    const id = await commitAudit(prisma, d);
    if (id) {
      await prisma.auditEvent.update({
        where: { id },
        data: {
          publishState: state,
          publishedAt: result.ok ? new Date() : null,
          publishError: result.error ?? null,
        },
      });
    }
  } catch {
    // Never let bookkeeping fail a publish the user can see succeeded.
  }
}
