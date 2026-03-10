import { getBlogBySlug } from "@/lib/data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const blog = await getBlogBySlug(slug);
  if (!blog) {
    return Response.json({ error: "Blog not found" }, { status: 404 });
  }
  return Response.json(blog);
}
