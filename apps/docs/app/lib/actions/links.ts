"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";

/**
 * `"use server"` exports are public POST endpoints addressable by action id, so
 * without the session check this was an unauthenticated write to SiteConfig —
 * the last immediate writer that could race a save on the same table.
 *
 * It reports failure rather than returning silently: the caller shows a green
 * tick on return, and an expired session must not look like a successful save.
 */
export async function updateResumeUrl(url: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };

  await prisma.siteConfig.upsert({
    where: { key: "resumeUrl" },
    create: { key: "resumeUrl", value: url },
    update: { value: url },
  });
  // /hero, not /links: the form moved there when /links became a redirect stub.
  revalidatePath("/hero");
  return { ok: true };
}
