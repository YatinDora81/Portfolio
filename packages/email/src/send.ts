import "server-only";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "@repo/config/env";
import { logger } from "@repo/shared/logger";

export const DEFAULT_FROM_NAME = "Yatin Dora";

export type SendResult = { ok: boolean; messageId?: string; error?: string };

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Set this to the sender's address on a notification, so Reply reaches them and not yourself. */
  replyTo?: string;
  inReplyTo?: string;
  references?: string | string[];
  fromName?: string;
};

let transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

function getTransporter(user: string, pass: string): Transporter<SMTPTransport.SentMessageInfo> {
  transporter ??= nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  return transporter;
}

// A display name lands inside a quoted header; a quote or newline in one would end it early.
function headerSafeName(value: string): string {
  return value.replace(/["\\\r\n]/g, "").trim() || DEFAULT_FROM_NAME;
}

/**
 * Never throws. A dead mailbox must not take down the write that preceded it,
 * so every failure comes back as `{ ok: false, error }` for the caller to record.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendResult> {
  const user = env.SMTP_EMAIL;
  const pass = env.SMTP_PASSWORD;
  if (!user || !pass) return { ok: false, error: "SMTP is not configured" };

  try {
    const info = await getTransporter(user, pass).sendMail({
      from: `"${headerSafeName(opts.fromName ?? DEFAULT_FROM_NAME)}" <${user}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      ...(opts.references ? { references: opts.references } : {}),
    });

    return { ok: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown mail transport error";
    logger.error("email", "sendMail failed", { error: message });
    return { ok: false, error: message };
  }
}
