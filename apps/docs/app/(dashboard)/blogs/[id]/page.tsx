import { prisma } from "db";
import { notFound } from "next/navigation";
import { BlogForm } from "../form";

export default async function EditBlogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blog = await prisma.blog.findUnique({ where: { id } });
  if (!blog) notFound();

  return (
    <BlogForm blog={{
      id: blog.id, slug: blog.slug, title: blog.title, description: blog.description,
      content: blog.content, image: blog.image, imageOrientation: blog.imageOrientation,
      color: blog.color, show: blog.show,
    }} />
  );
}
