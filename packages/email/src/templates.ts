import { env } from "@repo/config/env";
import { SPAM_THRESHOLD } from "@repo/shared/spam";
import {
  PALETTE,
  SANS,
  escapeHtml,
  escapeHtmlLines,
  heading,
  oneLine,
  row,
  safeUrl,
  shell,
} from "./html";

const SITE_NAME = "Yatin Dora";

export type RenderedEmail = { subject: string; html: string; text: string };

export type NotificationMessage = {
  id?: string | null;
  name: string;
  email: string;
  message: string;
  purpose?: string | null;
  country?: string | null;
  deviceType?: string | null;
  spamScore?: number | null;
  spamReasons?: string[] | null;
};

type Badge = { text: string; fg: string; border: string };

function spamBadge(score: number): Badge {
  if (score <= 0) return { text: `${score} · clean`, fg: "#4ade80", border: "#14532d" };
  if (score <= SPAM_THRESHOLD / 3) {
    return { text: `${score} · low`, fg: "#facc15", border: "#422006" };
  }
  if (score < SPAM_THRESHOLD) {
    return { text: `${score} · elevated`, fg: "#fb923c", border: "#431407" };
  }
  return { text: `${score} · high`, fg: "#f87171", border: "#450a0a" };
}

function adminLink(id: string | null | undefined): string | null {
  if (!id || !env.ADMIN_BASE_URL) return null;
  return safeUrl(`${env.ADMIN_BASE_URL.replace(/\/+$/, "")}/messages?id=${encodeURIComponent(id)}`);
}

function textRow(name: string, value: string): string {
  return `${name.padEnd(9)}${value}`;
}

export function renderNotificationEmail(msg: NotificationMessage): RenderedEmail {
  const name = oneLine(msg.name) || "Someone";
  const purpose = msg.purpose ? oneLine(msg.purpose) : "";
  const score = msg.spamScore ?? 0;
  const badge = spamBadge(score);
  const reasons = (msg.spamReasons ?? []).filter((r) => r.trim().length > 0);
  const link = adminLink(msg.id);

  const subject = purpose
    ? `New message from ${name} — ${purpose}`
    : `New message from ${name}`;

  const rows = [
    row("Name", escapeHtml(msg.name)),
    row(
      "Email",
      `<a href="mailto:${escapeHtml(encodeURI(msg.email))}" style="color:${PALETTE.text};text-decoration:underline;">${escapeHtml(msg.email)}</a>`,
    ),
    msg.country ? row("Country", escapeHtml(msg.country)) : "",
    msg.deviceType ? row("Device", escapeHtml(msg.deviceType)) : "",
    row(
      "Spam",
      `<span style="display:inline-block;padding:3px 10px;border:1px solid ${badge.border};border-radius:999px;background-color:${PALETTE.page};font-size:12px;line-height:18px;color:${badge.fg};">${escapeHtml(badge.text)}</span>${
        reasons.length
          ? `<div style="margin:6px 0 0;font-size:12px;line-height:18px;color:${PALETTE.faint};">${escapeHtml(reasons.join(", "))}</div>`
          : ""
      }`,
    ),
  ]
    .filter(Boolean)
    .join("\n            ");

  const button = link
    ? `<tr><td style="padding:0 24px 28px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background-color:${PALETTE.text};color:${PALETTE.page};font-family:${SANS};font-size:14px;font-weight:600;line-height:20px;text-decoration:none;">Open in admin</a>
        </td></tr>`
    : "";

  const html = shell({
    title: subject,
    preheader: oneLine(msg.message).slice(0, 140),
    footer: `Sent by the contact form on ${escapeHtml(SITE_NAME)}&rsquo;s site.`,
    content: `${heading("New message", purpose || undefined)}
        <tr><td style="padding:8px 24px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            ${rows}
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;">
          <div style="margin:0 0 8px;font-family:${SANS};font-size:11px;line-height:18px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.faint};">Message</div>
          <div style="padding:16px 18px;border:1px solid ${PALETTE.border};border-radius:8px;background-color:${PALETTE.page};font-family:${SANS};font-size:14px;line-height:22px;color:${PALETTE.text};">${escapeHtmlLines(msg.message)}</div>
        </td></tr>
${button}`,
  });

  const textLines: (string | null)[] = [
    subject,
    "",
    textRow("Name:", msg.name),
    textRow("Email:", msg.email),
    purpose ? textRow("Purpose:", purpose) : null,
    msg.country ? textRow("Country:", msg.country) : null,
    msg.deviceType ? textRow("Device:", msg.deviceType) : null,
    textRow("Spam:", reasons.length ? `${badge.text} (${reasons.join(", ")})` : badge.text),
    "",
    "Message",
    "-------",
    msg.message,
    "",
    link ? `Open in admin: ${link}` : null,
  ];

  return { subject, html, text: `${textLines.filter((l) => l !== null).join("\n")}\n` };
}

export type ReplyInput = { body: string; recipientName?: string | null };

export function renderReplyEmail(input: ReplyInput): { html: string; text: string } {
  const name = input.recipientName ? oneLine(input.recipientName) : "";
  const greeting = name ? `Hi ${name},` : "Hi,";
  const site = safeUrl(env.NEXT_PUBLIC_SITE_URL);

  const html = shell({
    title: `A reply from ${SITE_NAME}`,
    preheader: oneLine(input.body).slice(0, 140),
    footer: site
      ? `You wrote in through <a href="${escapeHtml(site)}" style="color:${PALETTE.muted};text-decoration:underline;">${escapeHtml(site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>. Just reply to this email to continue.`
      : "Just reply to this email to continue the conversation.",
    content: `<tr><td style="padding:32px 24px 8px;">
          <div style="font-family:${SANS};font-size:15px;line-height:24px;font-weight:600;color:${PALETTE.text};">${escapeHtml(greeting)}</div>
        </td></tr>
        <tr><td style="padding:8px 24px 24px;">
          <div style="font-family:${SANS};font-size:15px;line-height:24px;color:${PALETTE.text};">${escapeHtmlLines(input.body)}</div>
        </td></tr>
        <tr><td style="padding:0 24px 32px;">
          <div style="padding-top:20px;border-top:1px solid ${PALETTE.border};font-family:${SANS};font-size:14px;line-height:22px;color:${PALETTE.text};">&mdash; ${escapeHtml(SITE_NAME)}</div>
        </td></tr>`,
  });

  const text = [greeting, "", input.body, "", `— ${SITE_NAME}`, ""].join("\n");

  return { html, text };
}
