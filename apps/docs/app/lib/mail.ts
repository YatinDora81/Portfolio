import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function sendOtpEmail(to: string, otp: string) {
  await transporter.sendMail({
    from: `"Portfolio Admin" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "Your login OTP",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fafafa; background: #0a0a0a; padding: 24px; border-radius: 12px 12px 0 0; margin: 0; text-align: center;">
          Login OTP
        </h2>
        <div style="background: #171717; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #262626; border-top: none;">
          <p style="color: #a3a3a3; margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
            Too many failed login attempts. Use this OTP to sign in:
          </p>
          <div style="background: #0a0a0a; border: 1px solid #262626; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0;">
            <span style="color: #fafafa; font-size: 32px; font-weight: 700; letter-spacing: 8px;">${otp}</span>
          </div>
          <p style="color: #737373; margin: 16px 0 0; font-size: 12px; line-height: 1.5;">
            This OTP expires in 5 minutes. If you didn't request this, ignore this email.
          </p>
        </div>
      </div>
    `,
  });
}

export async function sendResetEmail(to: string, resetUrl: string) {
  await transporter.sendMail({
    from: `"Portfolio Admin" <${process.env.SMTP_EMAIL}>`,
    to,
    subject: "Reset your password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fafafa; background: #0a0a0a; padding: 24px; border-radius: 12px 12px 0 0; margin: 0; text-align: center;">
          Password Reset
        </h2>
        <div style="background: #171717; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #262626; border-top: none;">
          <p style="color: #a3a3a3; margin: 0 0 16px; font-size: 14px; line-height: 1.6;">
            You requested a password reset for your admin account. Click the button below to set a new password.
          </p>
          <a href="${resetUrl}" style="display: block; background: #fafafa; color: #0a0a0a; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; text-align: center; margin: 24px 0;">
            Reset Password
          </a>
          <p style="color: #737373; margin: 16px 0 0; font-size: 12px; line-height: 1.5;">
            This link expires in 15 minutes. If you didn't request this, ignore this email.
          </p>
        </div>
      </div>
    `,
  });
}
