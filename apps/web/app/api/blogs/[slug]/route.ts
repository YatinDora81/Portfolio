import { getBlogBySlug } from "@/lib/data";

// Unauthenticated and public: never pass a preview argument here, it would expose draft bodies as JSON.
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
