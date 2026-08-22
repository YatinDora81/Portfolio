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
      color: blog.color,
      status: blog.status,
      // Serialised here rather than handed over as a `Date`: the form is a
      // client component, and an ISO string is the one representation that
      // survives the boundary unchanged in both directions.
      publishAtIso: blog.publishAt?.toISOString() ?? null,
    }} />
  );
}
