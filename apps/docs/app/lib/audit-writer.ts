import { prisma } from "db";
import type { AuditActor, AuditDraft } from "@/lib/audit";
import { draft } from "@/lib/audit";

type Db = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$use" | "$extends" | "$transaction">;

type Session = { userId: string; email: string; role: string };

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

export async function recordPublish(
  session: Session,
  eventId: string | undefined,
  result: { ok: boolean; error?: string }
): Promise<void> {
  try {
    const state = result.ok ? "OK" : "FAILED";
    if (eventId) {
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
    // bookkeeping must not fail a publish that already landed
  }
}
