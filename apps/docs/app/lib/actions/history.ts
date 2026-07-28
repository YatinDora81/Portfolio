"use server";

import { prisma } from "db";
import { getSession } from "@/lib/session";

/**
 * The per-event field diffs, fetched only when a row is opened.
 *
 * Its own session check, because `"use server"` exports compile to public POST
 * endpoints and the history is the one table that quotes other people's work
 * verbatim. The list page is deliberately children-free — one reorder can carry
 * hundreds of these — so this is where the before/after text actually loads.
 */
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
