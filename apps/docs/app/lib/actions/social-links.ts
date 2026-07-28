"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so each writer below has to prove the session itself: middleware only
 * checks that the cookie holds a valid JWT, and it never runs for a direct
 * action POST at all.
 *
 * `redirect` rather than a returned `{ ok: false }` so an expired session can
 * never look like a successful write to a caller that ignores the return value.
 */
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

export async function createSocialLink(formData: FormData) {
  await requireSession();
  const name = formData.get("name") as string;
  const href = formData.get("href") as string;
  const iconKey = formData.get("iconKey") as string;
  const detail = (formData.get("detail") as string) || null;
  const { _max } = await prisma.socialLink.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  // No `version`: the column is nullable and NULL means shown in every hero
  // version, which is what a link added here should be. Scoping one to v1 or v2
  // is deliberate and happens on /social-links.
  await prisma.socialLink.create({ data: { name, href, iconKey, detail, sortOrder: count } });
  revalidatePath("/social-links");
  revalidatePath("/links");
}

export async function updateSocialLink(id: string, formData: FormData) {
  await requireSession();
  const name = formData.get("name") as string;
  const href = formData.get("href") as string;
  const iconKey = formData.get("iconKey") as string;
  const detail = (formData.get("detail") as string) || null;
  await prisma.socialLink.update({ where: { id }, data: { name, href, iconKey, detail } });
  revalidatePath("/social-links");
  revalidatePath("/links");
}

export async function deleteSocialLink(id: string) {
  await requireSession();
  await prisma.socialLink.delete({ where: { id } });
  revalidatePath("/social-links");
  revalidatePath("/links");
}
