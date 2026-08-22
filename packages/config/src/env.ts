import "server-only";
import { z } from "zod";

/**
 * One parse, at module load, so a missing variable is a boot failure naming the
 * variable rather than a 3am `PrismaClientInitializationError` twelve frames
 * deep in a request nobody can reproduce.
 *
 * The required/optional split is the whole design, and it is not a matter of
 * taste:
 *
 *   REQUIRED  — the app cannot render a page without it. Fail loudly at boot.
 *   OPTIONAL  — a feature needs it. Absent means that ONE feature is off and
 *               everything else still serves. A required-by-default schema here
 *               would mean adding a media manager takes the portfolio down in
 *               every environment that has not been given R2 credentials yet.
 *
 * So: anything a later phase introduces arrives `.optional()`, and the feature
 * that needs it checks for itself. Promote a variable to required only once
 * every environment provably has it.
 *
 * Read variables from `env` and never from `process.env` in feature code — a
 * direct read is the one path that skips this file, and it skips the validation
 * with it.
 */
const serverSchema = z.object({
  // ---- Required. The app does not serve without these. -------------------
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  /**
   * Shared by both apps: the admin signs its revalidation POSTs with it and the
   * public app checks them. `min(32)` is a real floor, not decoration — this
   * secret is the only thing standing between the internet and the ability to
   * flush the site's entire cache on demand.
   */
  REVALIDATE_SECRET: z.string().min(32),

  /**
   * The public origin. Absent from every local `.env`, which is why it carries
   * the same default the 23 call sites in `apps/web` already hardcode — adding
   * this file must not change where a build points.
   */
  NEXT_PUBLIC_SITE_URL: z.string().url().default("https://www.yatindora.in"),

  // ---- Admin-only. Present in apps/docs, absent in apps/web. --------------
  /**
   * Not `min(32)` despite being a signing key: the deployed value is 25
   * characters and tightening the floor here would lock every admin out at
   * boot. Rotating it to something longer is worth doing, and is a separate
   * change with a login flow to re-test.
   */
  JWT_SECRET: z.string().min(1).optional(),
  SMTP_EMAIL: z.string().email().optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),

  // ---- Optional, per feature. Held by BOTH apps at the same value. --------
  /**
   * Signs Draft Mode preview links: the admin mints one, the public app
   * verifies it before enabling draft mode. It has to be a SEPARATE secret from
   * `JWT_SECRET` — an admin session token and a preview token must not be
   * interchangeable, or a 30-minute share link would be a 7-day admin
   * credential under a different name.
   *
   * Optional, and set nowhere yet: with no value, minting and verifying both
   * refuse and preview is simply off. `min(32)` because it is a signing key
   * with no legacy value to accommodate — unlike `JWT_SECRET` above, nothing is
   * deployed against it, so the floor can be right from the start.
   */
  PREVIEW_SECRET: z.string().min(32).optional(),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  // `.flatten()`, not `.treeifyError()` — this repo is on the v3 API surface of
  // zod 3.25 (the v4 surface lives behind the `zod/v4` subpath and is not what
  // `import { z } from "zod"` resolves to).
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

export type Env = typeof env;
