"use server";

import { redirect } from "next/navigation";
import { env } from "@repo/config/env";
import { createPreviewToken } from "@repo/shared/preview-token";
import type { PreviewClaims } from "@repo/shared/preview-token";
import { getSession } from "@/lib/session";

async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

const NO_SECRET =
  "PREVIEW_SECRET is not configured in this environment, so preview links cannot be signed. " +
  "Set it on the admin and the public app — the same value on both, and never the one in " +
  "JWT_SECRET — and preview comes back on its own.";

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

export async function previewLinkBlockedReason(): Promise<string | null> {
  await requireSession();
  return (await createPreviewToken({ type: "Home" })) === null ? NO_SECRET : null;
}
