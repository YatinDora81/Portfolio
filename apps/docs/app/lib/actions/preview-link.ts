"use server";

import { redirect } from "next/navigation";
import { env } from "@repo/config/env";
import { createPreviewToken } from "@repo/shared/preview-token";
import type { PreviewClaims } from "@repo/shared/preview-token";
import { getSession } from "@/lib/session";

/**
 * Mints the signed link that opens unpublished content on the public site.
 *
 * Session-guarded like every other writer in this folder, and for a stronger
 * reason than most of them: a preview token *is* read access to everything that
 * is not published yet. `"use server"` exports compile to public POST endpoints
 * addressable by action id, and middleware never runs for a direct action POST,
 * so an unguarded export here would hand a draft-reader to anyone who could
 * reach the origin.
 */
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

/**
 * `createPreviewToken` returns null when `PREVIEW_SECRET` is unset, which is
 * the state this environment is actually in. That is a configuration fact, not
 * a failure — so it is reported in the admin's own words and the button that
 * would have used it is disabled with this as its reason, rather than throwing
 * on every press.
 */
const NO_SECRET =
  "PREVIEW_SECRET is not configured in this environment, so preview links cannot be signed. " +
  "Set it on the admin and the public app — the same value on both, and never the one in " +
  "JWT_SECRET — and preview comes back on its own.";

/**
 * The claims go to the minter untouched rather than being flattened into a
 * path here. `{ type: "Home" }` is not a fallback for "no slug": `Project` has
 * no unique string column and there is no `/projects/[slug]` route, so the
 * homepage in draft mode is the only surface a draft project appears on, and
 * the token says so in as many words.
 */
export async function createPreviewLink(
  input: PreviewClaims
): Promise<{ ok: boolean; url?: string; error?: string }> {
  await requireSession();

  if (input.type === "Blog" && input.slug.trim() === "") {
    return { ok: false, error: "This post has no slug yet, so there is no page to preview." };
  }

  const token = await createPreviewToken(input);
  if (!token) return { ok: false, error: NO_SECRET };

  const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  return { ok: true, url: `${site}/api/preview?token=${encodeURIComponent(token)}` };
}

/**
 * Whether preview links can be minted at all, resolved once per page load so a
 * list can render its Preview buttons disabled-with-a-reason instead of letting
 * every one of them fail on click.
 *
 * It asks the minter rather than reading the variable itself, deliberately: one
 * function decides whether preview is configured, and a probe that goes through
 * it cannot drift from the answer the real call would give. The token is signed
 * and thrown away — an HMAC over a fixed claim, no I/O, nothing stored, and it
 * grants only the homepage even if it somehow escaped.
 */
export async function previewLinkBlockedReason(): Promise<string | null> {
  await requireSession();
  return (await createPreviewToken({ type: "Home" })) === null ? NO_SECRET : null;
}
