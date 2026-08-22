"use server";

import { prisma } from "db";
import type { MessageStatus } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { escapeHtmlLines, oneLine } from "@repo/email/html";
import { sendEmail } from "@repo/email/send";
import { renderReplyEmail } from "@repo/email/templates";
import { logger } from "@repo/shared/logger";
import { getSession } from "@/lib/session";
import { applyVars } from "@/(dashboard)/messages/text";

export type MessageResult = { ok: true } | { ok: false; error: string };

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
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

// The legacy `read` boolean mirrors the enum until it is dropped.
const readFor = (status: MessageStatus) => status !== "UNREAD";

export async function markMessageRead(id: string): Promise<MessageResult> {
  await requireSession();
  // Guarded on UNREAD via `updateMany`: opening a REPLIED message must not walk it back to READ.
  await prisma.contactMessage.updateMany({
    where: { id, status: "UNREAD" },
    data: { status: "READ", read: true, readAt: new Date() },
  });
  revalidatePath("/messages");
  return { ok: true };
}

export async function markMessageUnread(id: string): Promise<MessageResult> {
  await requireSession();
  await prisma.contactMessage.updateMany({
    where: { id, status: { in: ["UNREAD", "READ"] } },
    data: { status: "UNREAD", read: false, readAt: null },
  });
  revalidatePath("/messages");
  return { ok: true };
}

export async function setMessageStarred(id: string, starred: boolean): Promise<MessageResult> {
  await requireSession();
  await prisma.contactMessage.updateMany({ where: { id }, data: { starred } });
  revalidatePath("/messages");
  return { ok: true };
}

export async function deleteMessage(id: string): Promise<MessageResult> {
  await requireSession();
  await prisma.contactMessage.delete({ where: { id } });
  revalidatePath("/messages");
  return { ok: true };
}

const BULK_ACTIONS = ["archive", "read", "spam", "inbox"] as const;

export type BulkAction = (typeof BULK_ACTIONS)[number];

const BulkInput = z.object({
  ids: z.array(z.string().min(1)).min(1, "Nothing was selected.").max(200),
  action: z.enum(BULK_ACTIONS),
});

export async function bulkUpdateMessages(input: {
  ids: string[];
  action: BulkAction;
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  await requireSession();

  const parsed = BulkInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That is not a valid bulk action." };
  }
  const { ids, action } = parsed.data;

  if (action === "inbox") {
    const filed = { id: { in: ids }, status: { in: ["ARCHIVED", "SPAM"] as MessageStatus[] } };
    // Two passes because `updateMany` carries one `data`: an answered message returns as REPLIED.
    const replied = await prisma.contactMessage.updateMany({
      where: { ...filed, repliedAt: { not: null } },
      data: { status: "REPLIED", read: true },
    });
    const read = await prisma.contactMessage.updateMany({
      where: { ...filed, repliedAt: null },
      data: { status: "READ", read: true },
    });
    revalidatePath("/messages");
    return { ok: true, count: replied.count + read.count };
  }

  const next: MessageStatus = action === "archive" ? "ARCHIVED" : action === "spam" ? "SPAM" : "READ";

  // "read" only lifts UNREAD; archive and spam may take a REPLIED row, since `repliedAt` survives.
  const where =
    action === "read"
      ? { id: { in: ids }, status: "UNREAD" as MessageStatus }
      : { id: { in: ids }, status: { not: next } };

  const updated = await prisma.contactMessage.updateMany({
    where,
    data: {
      status: next,
      read: readFor(next),
      ...(action === "read" ? { readAt: new Date() } : {}),
    },
  });

  revalidatePath("/messages");
  return { ok: true, count: updated.count };
}

const MAX_REPLY_CHARS = 10_000;

const ReplyInput = z.object({
  messageId: z.string().min(1),
  subject: z.string().trim().min(1, "The reply needs a subject.").max(200, "Keep the subject under 200 characters."),
  body: z
    .string()
    .trim()
    .min(1, "The reply is empty.")
    .max(MAX_REPLY_CHARS, `Keep the reply under ${MAX_REPLY_CHARS} characters.`),
  templateId: z.string().min(1).optional(),
});

/** Send-only: the MessageReply row is the whole local record, written even when the send fails. */
export async function sendMessageReply(input: {
  messageId: string;
  subject: string;
  body: string;
  templateId?: string;
}): Promise<MessageResult> {
  const session = await requireSession();

  const parsed = ReplyInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That reply could not be read." };
  }

  const message = await prisma.contactMessage.findUnique({
    where: { id: parsed.data.messageId },
    select: { id: true, name: true, email: true, purpose: true, notificationMessageId: true },
  });
  if (!message) return { ok: false, error: "That message is no longer in the inbox." };

  const vars = { name: message.name, purpose: message.purpose ?? "" };
  const body = applyVars(parsed.data.body, vars);
  const subject = oneLine(applyVars(parsed.data.subject, vars)).slice(0, 200);

  const { html, text } = renderReplyEmail({ body, recipientName: message.name });

  // Threads onto the notification copy in Gmail; without it the reply starts a second thread.
  const thread = message.notificationMessageId
    ? { inReplyTo: message.notificationMessageId, references: message.notificationMessageId }
    : {};

  const sent = await sendEmail({ to: message.email, subject, html, text, ...thread });

  const error = sent.ok ? null : (sent.error ?? "The mailer failed and returned no error text.");

  await prisma.messageReply.create({
    data: {
      messageId: message.id,
      subject,
      bodyHtml: html,
      bodyText: text,
      sentById: session.userId,
      outboundMessageId: sent.messageId ?? null,
      deliveryOk: sent.ok,
      deliveryError: error,
    },
  });

  if (sent.ok) {
    await prisma.contactMessage.update({
      where: { id: message.id },
      data: { status: "REPLIED", read: true, repliedAt: new Date() },
    });
    if (parsed.data.templateId) {
      await prisma.replyTemplate.updateMany({
        where: { id: parsed.data.templateId },
        data: { useCount: { increment: 1 } },
      });
    }
  } else {
    logger.error("inbox", "reply send failed", { messageId: message.id, error });
  }

  revalidatePath("/messages");
  return sent.ok ? { ok: true } : { ok: false, error: error ?? "The reply was not sent." };
}

const TemplateInput = z.object({
  name: z.string().trim().min(1, "A template needs a name.").max(80, "Keep the name under 80 characters."),
  subject: z.string().trim().min(1, "A template needs a subject.").max(200, "Keep the subject under 200 characters."),
  body: z.string().trim().min(1, "A template needs a body.").max(MAX_REPLY_CHARS),
});

export async function createReplyTemplate(input: {
  name: string;
  subject: string;
  body: string;
}): Promise<MessageResult> {
  await requireSession();

  const parsed = TemplateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That template could not be read." };
  }

  await prisma.replyTemplate.create({
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      bodyHtml: escapeHtmlLines(parsed.data.body),
    },
  });

  revalidatePath("/messages");
  return { ok: true };
}

export async function deleteReplyTemplate(id: string): Promise<MessageResult> {
  await requireSession();
  await prisma.replyTemplate.deleteMany({ where: { id } });
  revalidatePath("/messages");
  return { ok: true };
}
