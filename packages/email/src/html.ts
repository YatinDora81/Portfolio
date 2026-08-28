export const PALETTE = {
  page: "#0a0a0a",
  card: "#171717",
  border: "#262626",
  text: "#fafafa",
  muted: "#a3a3a3",
  faint: "#737373",
} as const;

export const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

export function escapeHtmlLines(value: string | null | undefined): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br />");
}

// subjects become a mail header; crlf is injection
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function label(text: string): string {
  return `<td width="88" valign="top" style="width:88px;padding:8px 16px 8px 0;font-family:${SANS};font-size:11px;line-height:18px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.faint};">${escapeHtml(text)}</td>`;
}

export function row(name: string, valueHtml: string): string {
  return `<tr>${label(name)}<td valign="top" style="padding:8px 0;font-family:${SANS};font-size:14px;line-height:22px;color:${PALETTE.text};">${valueHtml}</td></tr>`;
}

export function heading(text: string, sub?: string): string {
  const subline = sub
    ? `<div style="margin:6px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${PALETTE.muted};">${escapeHtml(sub)}</div>`
    : "";
  return `<tr><td style="padding:28px 24px 20px;border-bottom:1px solid ${PALETTE.border};">
        <div style="font-family:${SANS};font-size:19px;line-height:26px;font-weight:600;color:${PALETTE.text};">${escapeHtml(text)}</div>${subline}
      </td></tr>`;
}

export function shell(opts: {
  title: string;
  preheader: string;
  content: string;
  footer?: string;
}): string {
  const footer = opts.footer
    ? `<div style="margin:16px auto 0;max-width:600px;font-family:${SANS};font-size:12px;line-height:18px;color:${PALETTE.faint};text-align:center;">${opts.footer}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark" />
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${PALETTE.page};">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${PALETTE.page};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:12px;">
${opts.content}
      </table>
      ${footer}
    </td>
  </tr>
</table>
</body>
</html>`;
}
