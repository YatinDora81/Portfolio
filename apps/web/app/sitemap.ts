import type { MetadataRoute } from "next";
import { getBlogs } from "./lib/data";
import { SITE_URL } from "./lib/site";

// Regenerate on the same cadence as the pages themselves.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Public, always, and deliberately not parameterised: a sitemap is written
  // for crawlers, and its whole purpose is to hand out URLs to be indexed.
  // Listing a draft here would ask Google to fetch and remember a page that is
  // not supposed to exist yet, and it would do that from a cached XML file that
  // outlives the preview session. `getBlogs()` defaults to public — there is no
  // preview argument to pass here, and nothing should ever add one.
  const blogs = await getBlogs();

  const blogEntries: MetadataRoute.Sitemap = blogs.map((b) => ({
    url: `${SITE_URL}/blog/${b.slug}`,
    lastModified: b.updatedAt,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...blogEntries,
  ];
}
