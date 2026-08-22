import "server-only";
import { z } from "zod";

// Required here means the app will not boot without it, so new variables arrive
// `.optional()` and the feature that needs one checks for itself.
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  REVALIDATE_SECRET: z.string().min(32),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("https://www.yatindora.in"),

  // Admin-only: present in apps/docs, absent in apps/web.
  // `min(1)`, not `min(32)` — the deployed value is 25 chars and a tighter floor
  // would lock every admin out at boot.
  JWT_SECRET: z.string().min(1).optional(),
  SMTP_EMAIL: z.string().email().optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),

  // Both apps, same value. Must stay a different secret from `JWT_SECRET`, or a
  // 30-minute preview link is a 7-day admin credential.
  PREVIEW_SECRET: z.string().min(32).optional(),

  // Contact form defenses. Each absent means that one defense is off, never that the form breaks.
  CONTACT_FORM_HMAC_SECRET: z.string().min(32).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  NOTIFY_EMAIL_TO: z.string().email().optional(),
  ADMIN_BASE_URL: z.string().url().optional(),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  // `.flatten()`, not `.treeifyError()` — this repo is on zod 3.25's v3 surface.
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

export type Env = typeof env;
