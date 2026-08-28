"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

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
    if (res.ok) {
      revalidatePath("/contact-purposes");
      return { ok: true };
    }

    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Refresh returned ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the site." };
  }
}
