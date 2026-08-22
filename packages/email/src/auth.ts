import "server-only";
import { PALETTE, SANS, escapeHtml, safeUrl, shell } from "./html";
import { sendEmail } from "./send";

const FROM_NAME = "Portfolio Admin";

/** Throws on failure — a caller that reports "check your inbox" must not do so when nothing was sent. */
async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  const result = await sendEmail({ to, subject, html, text, fromName: FROM_NAME });
  if (!result.ok) throw new Error(result.error ?? "Failed to send email");
}

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const html = shell({
    title: "Your login OTP",
    preheader: "Your one-time login code expires in 5 minutes.",
    content: `<tr><td style="padding:28px 24px 8px;">
          <div style="font-family:${SANS};font-size:19px;line-height:26px;font-weight:600;color:${PALETTE.text};">Login OTP</div>
          <div style="margin:12px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${PALETTE.muted};">Too many failed login attempts. Use this code to sign in:</div>
        </td></tr>
        <tr><td align="center" style="padding:20px 24px;">
          <div style="padding:16px;border:1px solid ${PALETTE.border};border-radius:8px;background-color:${PALETTE.page};font-family:${SANS};font-size:32px;font-weight:700;letter-spacing:8px;color:${PALETTE.text};">${escapeHtml(otp)}</div>
        </td></tr>
        <tr><td style="padding:0 24px 28px;">
          <div style="font-family:${SANS};font-size:12px;line-height:20px;color:${PALETTE.faint};">This code expires in 5 minutes. If you didn&rsquo;t request it, ignore this email.</div>
        </td></tr>`,
  });

  const text = `Login OTP\n\nToo many failed login attempts. Use this code to sign in:\n\n${otp}\n\nThis code expires in 5 minutes. If you didn't request it, ignore this email.\n`;

  await send(to, "Your login OTP", html, text);
}

export async function sendResetEmail(to: string, resetUrl: string): Promise<void> {
  const url = safeUrl(resetUrl);
  if (!url) throw new Error("Invalid reset URL");

  const html = shell({
    title: "Reset your password",
    preheader: "Set a new admin password. The link expires in 15 minutes.",
    content: `<tr><td style="padding:28px 24px 8px;">
          <div style="font-family:${SANS};font-size:19px;line-height:26px;font-weight:600;color:${PALETTE.text};">Password reset</div>
          <div style="margin:12px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${PALETTE.muted};">You requested a password reset for your admin account. Use the button below to set a new one.</div>
        </td></tr>
        <tr><td style="padding:20px 24px;">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background-color:${PALETTE.text};color:${PALETTE.page};font-family:${SANS};font-size:14px;font-weight:600;line-height:20px;text-decoration:none;">Reset password</a>
        </td></tr>
        <tr><td style="padding:0 24px 28px;">
          <div style="font-family:${SANS};font-size:12px;line-height:20px;color:${PALETTE.faint};">This link expires in 15 minutes. If you didn&rsquo;t request it, ignore this email.</div>
        </td></tr>`,
  });

  const text = `Password reset\n\nYou requested a password reset for your admin account. Open this link to set a new one:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.\n`;

  await send(to, "Reset your password", html, text);
}
