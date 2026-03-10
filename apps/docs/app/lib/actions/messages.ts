"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";

export async function markMessageRead(id: string) {
  await prisma.contactMessage.update({ where: { id }, data: { read: true } });
  revalidatePath("/messages");
}

export async function markMessageUnread(id: string) {
  await prisma.contactMessage.update({ where: { id }, data: { read: false } });
  revalidatePath("/messages");
}

export async function deleteMessage(id: string) {
  await prisma.contactMessage.delete({ where: { id } });
  revalidatePath("/messages");
}
