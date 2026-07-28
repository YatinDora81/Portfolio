"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so each writer below has to prove the session itself: middleware only
 * checks that the cookie holds a valid JWT, and it never runs for a direct
 * action POST at all.
 *
 * `redirect` rather than a returned `{ ok: false }` so an expired session can
 * never look like a successful write to a caller that ignores the return value.
 */
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

export async function markMessageRead(id: string) {
  await requireSession();
  await prisma.contactMessage.update({ where: { id }, data: { read: true } });
  revalidatePath("/messages");
}

export async function markMessageUnread(id: string) {
  await requireSession();
  await prisma.contactMessage.update({ where: { id }, data: { read: false } });
  revalidatePath("/messages");
}

export async function deleteMessage(id: string) {
  await requireSession();
  await prisma.contactMessage.delete({ where: { id } });
  revalidatePath("/messages");
}
