import { getBlogBySlug } from "@/lib/data";

/**
 * Strictly public. This endpoint never honours draft mode, and that is a
 * decision rather than an omission.
 *
 * It is unauthenticated, it returns the entire post including `content`, and it
 * has no UI — nobody previews anything by reading JSON. Wiring draft mode in
 * would buy nothing and would turn one signed cookie into a draft-exfiltration
 * endpoint: anything that could get that cookie in front of this route — an
 * `<img>` on another origin, a shared browser, a link opened in a preview
 * session, a proxy that forwards cookies — could pull down every unpublished
 * body as clean JSON, with none of the ISR bypass and none of the visual
 * "you are previewing" cues a page render has.
 *
 * The preview surface for a post is `/blog/[slug]` in draft mode. This stays
 * the surface that only ever answers for something already published.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // No second argument, on purpose. See above.
  const blog = await getBlogBySlug(slug);
  if (!blog) {
    // Same 404 whether the post is missing, drafted, scheduled or archived —
    // the response must not tell an anonymous caller that a slug exists.
    return Response.json({ error: "Blog not found" }, { status: 404 });
  }
  return Response.json(blog);
}
