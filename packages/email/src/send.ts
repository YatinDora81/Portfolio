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

function headerSafeName(value: string): string {
  return value.replace(/["\\\r\n]/g, "").trim() || DEFAULT_FROM_NAME;
}

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
