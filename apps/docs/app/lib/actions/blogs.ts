"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * `"use server"` exports compile to public POST endpoints addressable by action
 * id, so each writer below has to prove the session itself: middleware only
 * checks that the cookie holds a valid JWT, and it never runs for a direct
 * action POST at all. Until this was added, `deleteBlog` was reachable by
 * anyone who could reach the origin.
 *
 * `redirect` rather than a returned `{ ok: false }`, because two of these are
 * invoked from inline server closures in blogs/page.tsx that discard the return
 * value — an expired session would otherwise do nothing at all while the UI
 * carried on as if the write had landed.
 */
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

export async function createBlog(formData: FormData) {
  await requireSession();
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
      show: formData.get("show") === "true",
      sortOrder: count,
    },
  });
  revalidatePath("/blogs");
}

export async function updateBlog(id: string, formData: FormData) {
  await requireSession();
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
      show: formData.get("show") === "true",
    },
  });
  revalidatePath("/blogs");
}

export async function toggleBlogVisibility(id: string, show: boolean) {
  await requireSession();
  await prisma.blog.update({ where: { id }, data: { show } });
  revalidatePath("/blogs");
}

export async function deleteBlog(id: string) {
  await requireSession();
  await prisma.blog.delete({ where: { id } });
  revalidatePath("/blogs");
}
