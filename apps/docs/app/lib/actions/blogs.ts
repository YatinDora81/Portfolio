"use server";

import { prisma } from "db";
import { revalidatePath } from "next/cache";
import { revalidatePortfolio } from "@/lib/revalidate";

export async function createBlog(formData: FormData) {
  const count = await prisma.blog.count();
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
  revalidatePortfolio();
}

export async function updateBlog(id: string, formData: FormData) {
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
  revalidatePortfolio();
}

export async function toggleBlogVisibility(id: string, show: boolean) {
  await prisma.blog.update({ where: { id }, data: { show } });
  revalidatePath("/blogs");
  revalidatePortfolio();
}

export async function deleteBlog(id: string) {
  await prisma.blog.delete({ where: { id } });
  revalidatePath("/blogs");
  revalidatePortfolio();
}
