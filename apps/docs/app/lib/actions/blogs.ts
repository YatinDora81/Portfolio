"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveLifecycle } from "@/lib/lifecycle";

// middleware never runs for a direct server-action POST
async function requireSession() {
  if (!(await getSession())) redirect("/login");
}

type Saved = { ok: boolean; error?: string };

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
      status: lifecycle.status,
      publishAt: lifecycle.publishAt,
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
      // publishedAt is the printed editorial date, not a lifecycle stamp
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
