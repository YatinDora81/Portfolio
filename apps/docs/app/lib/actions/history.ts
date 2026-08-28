"use server";

import { prisma } from "db";
import { getSession } from "@/lib/session";

export async function historyDetail(eventId: string): Promise<{
  ok: boolean;
  changes?: {
    seq: number; kind: string; entityLabel: string; rowLabel: string | null;
    field: string; before: string | null; after: string | null;
    redacted: boolean; truncated: boolean;
  }[];
}> {
  const session = await getSession();
  if (!session) return { ok: false };
  if (typeof eventId !== "string" || eventId === "") return { ok: false };

  const changes = await prisma.auditChange.findMany({
    where: { eventId },
    orderBy: { seq: "asc" },
    select: {
      seq: true, kind: true, entityLabel: true, rowLabel: true,
      field: true, before: true, after: true, redacted: true, truncated: true,
    },
  });
  return { ok: true, changes };
}
