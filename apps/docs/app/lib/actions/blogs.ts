"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveLifecycle } from "@/lib/lifecycle";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so each writer below has to prove the session itself: middleware only
 * checks that the cookie holds a valid JWT, and it never runs for a direct
 * action POST at all. Until this was added, `deleteBlog` was reachable by
 * anyone who could reach the origin.
 *
 * `redirect` rather than a returned `{ ok: false }`, because `deleteBlog` is
 * invoked from an inline server closure in blogs/page.tsx that discards the
 * return value — an expired session would otherwise do nothing at all while the
 * UI carried on as if the write had landed.
 */
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

type Saved = { ok: boolean; error?: string };

/**
 * Both writers read the lifecycle through `resolveLifecycle`, which refuses a
 * status it does not recognise rather than defaulting to one — the fix for the
 * `show: formData.get("show") === "true"` trap these two lines used to be. The
 * reasoning lives in lib/lifecycle.ts, next to the check itself.
 */
const readLifecycle = (formData: FormData) =>
  resolveLifecycle(formData.get("status"), formData.get("publishAtIst"));

export async function createBlog(formData: FormData): Promise<Saved> {
  await requireSession();

  const lifecycle = readLifecycle(formData);
  if (!lifecycle.ok) return { ok: false, error: lifecycle.error };

  const { _max } = await prisma.blog.aggregate({ _max: { sortOrder: true } });
  const count = (_max.sortOrder ?? -1) + 1;
  await prisma.blog.create({
    data: {
      slug: formData.get("slug") as string,
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      content: formData.get("content") as string,
      image: formData.get("image") as string,
      imageOrientation: (formData.get("imageOrientation") as "LANDSCAPE" | "PORTRAIT" | "SQUARE") || "LANDSCAPE",
      color: formData.get("color") as string,
      // `show` is deliberately absent. The column still exists so the lifecycle
      // can be rolled back, and it keeps its `true` default, but nothing reads
      // it any more — `status` is the whole answer to "is this live".
      status: lifecycle.status,
      publishAt: lifecycle.publishAt,
      // `publishedAt` is not written either. It is the editorial date the
      // article prints, it predates the lifecycle, and its `now()` default is
      // already the right answer for something written today.
      sortOrder: count,
    },
  });
  revalidatePath("/blogs");
  return { ok: true };
}

export async function updateBlog(id: string, formData: FormData): Promise<Saved> {
  await requireSession();

  const lifecycle = readLifecycle(formData);
  if (!lifecycle.ok) return { ok: false, error: lifecycle.error };

  await prisma.blog.update({
    where: { id },
    data: {
      slug: formData.get("slug") as string,
      title: formData.get("title") as string,
      description: formData.get("description") as string,
      content: formData.get("content") as string,
      image: formData.get("image") as string,
      imageOrientation: (formData.get("imageOrientation") as "LANDSCAPE" | "PORTRAIT" | "SQUARE") || "LANDSCAPE",
      color: formData.get("color") as string,
      status: lifecycle.status,
      publishAt: lifecycle.publishAt,
      // Neither `show` nor `publishedAt` is touched — see createBlog. Rewriting
      // `publishedAt` from a status change would move the printed date on every
      // post that has already been published once.
    },
  });
  revalidatePath("/blogs");
  return { ok: true };
}

export async function deleteBlog(id: string) {
  await requireSession();
  await prisma.blog.delete({ where: { id } });
  revalidatePath("/blogs");
}
