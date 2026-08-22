import "server-only";
import { z } from "zod";

// Required here means the app will not boot without it, so new variables arrive
// `.optional()` and the feature that needs one checks for itself.

/**
 * `KEY=""` means unset, not invalid.
 *
 * A bare `.optional()` still validates a present empty string, so the blank line
 * copied straight out of .env.example fails the parse — and a failed parse
 * throws below, which takes the whole app down at boot rather than switching one
 * feature off. Wrap any variable whose .env.example line ships blank.
 */
function blankIsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema);
}

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

  // Cloudflare R2, for the admin's media manager. All four or none: with any of
  // them missing the manager still lists what is already stored and says which
  // variable is absent, and nothing signs an upload.
  R2_ACCOUNT_ID: blankIsUnset(z.string().min(1).optional()),
  R2_ACCESS_KEY_ID: blankIsUnset(z.string().min(1).optional()),
  R2_SECRET_ACCESS_KEY: blankIsUnset(z.string().min(1).optional()),
  R2_BUCKET: blankIsUnset(z.string().min(1).optional()),

  // The origin an uploaded object is readable from, written into the row at
  // upload time. Unset stores the key as a root-relative path, which is what
  // `cdnUrl()` in both apps already resolves against NEXT_PUBLIC_CDN_URL — so
  // this is a pin, not a second copy of that variable. Same host as it, always.
  CDN_BASE_URL: blankIsUnset(z.string().url().optional()),
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
