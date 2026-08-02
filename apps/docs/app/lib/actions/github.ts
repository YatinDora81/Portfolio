"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

/**
 * Forces the site to poll GitHub now, instead of waiting for the 20h-gated
 * refresh its homepage render does on its own.
 *
 * Shaped like `publishSite`, and for the same reason: the archive and the merge
 * live in apps/web, so the admin reaches them over HTTP with the shared secret
 * rather than importing across app boundaries. The handle is not sent — the site
 * reads it from the SocialLink row itself, so this button cannot be pointed at
 * someone else's account.
 *
 * Open to every signed-in admin. Nothing here is destructive: a failed refresh
 * writes nothing and leaves the stored history exactly as it was.
 */
export async function refreshGithub(): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return { ok: false, error: "REVALIDATE_SECRET isn't set on the admin app." };

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

  try {
    const res = await fetch(`${site}/api/github/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
      cache: "no-store",
    });
    // The button now sits inside the tile that reads this archive, so the
    // figures, the "captured …" stamp and the fresh/stale chip beside it all go
    // stale the moment the refresh lands. Without this the button reports
    // "Archive updated" over numbers that are visibly the old ones.
    if (res.ok) {
      revalidatePath("/contact-purposes");
      return { ok: true };
    }

    // The site distinguishes "no handle to read" from "the mirror wouldn't
    // answer", and they need different things done about them, so the message
    // comes back rather than a bare status.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Refresh returned ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
  }
}
