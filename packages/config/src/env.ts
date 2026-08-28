import "server-only";
import { z } from "zod";

// `KEY=""` is unset, not invalid
function blankIsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema);
}

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  REVALIDATE_SECRET: z.string().min(32),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("https://www.yatindora.in"),

  // min(1), not min(32): the deployed value is 25 chars
  JWT_SECRET: z.string().min(1).optional(),
  SMTP_EMAIL: z.string().email().optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),

  PREVIEW_SECRET: z.string().min(32).optional(),

  CONTACT_FORM_HMAC_SECRET: z.string().min(32).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  NOTIFY_EMAIL_TO: z.string().email().optional(),
  ADMIN_BASE_URL: z.string().url().optional(),

  R2_ACCOUNT_ID: blankIsUnset(z.string().min(1).optional()),
  R2_ACCESS_KEY_ID: blankIsUnset(z.string().min(1).optional()),
  R2_SECRET_ACCESS_KEY: blankIsUnset(z.string().min(1).optional()),
  R2_BUCKET: blankIsUnset(z.string().min(1).optional()),

  CDN_BASE_URL: blankIsUnset(z.string().url().optional()),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

export type Env = typeof env;
