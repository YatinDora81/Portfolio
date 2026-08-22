import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { draftMode } from 'next/headers';
import { getBlogBySlug, getBlogs } from '@/lib/data';
import { getFlags } from '@/lib/flags';
import { FLAG_KEYS, flagValue } from '@repo/shared/flags';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import MotionProvider from '@/components/common/MotionProvider';
import BackgroundLines from '@/components/common/BackgroundLines';
import BlogContent from './BlogContent';

export async function generateStaticParams() {
  // Public, and structurally unable to be anything else: this runs at build
  // time with no request behind it, so `draftMode()` would throw here rather
  // than return false. Prerendering a draft is exactly what must not happen —
  // the HTML would be cached and served to everyone. Drafts stay reachable in
  // preview through `dynamicParams`, which renders an unlisted slug on demand.
  //
  // Zero slugs today is the correct answer, not a failure: every post is DRAFT.
  const blogs = await getBlogs();
  return blogs.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Same cookie the page body reads, so a preview of a draft gets that draft's
  // title instead of "Blog not found" above its own rendered content.
  const { isEnabled: isPreview } = await draftMode();
  const blog = await getBlogBySlug(slug, isPreview);
  if (!blog) return { title: 'Blog not found' };

  const description = blog.description ?? undefined;
  return {
    title: blog.title,
    description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: 'article',
      url: `/blog/${slug}`,
      title: blog.title,
      description,
      ...(blog.publishedAt
        ? { publishedTime: new Date(blog.publishedAt).toISOString() }
        : {}),
      ...(blog.updatedAt
        ? { modifiedTime: new Date(blog.updatedAt).toISOString() }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: blog.title,
      description,
    },
  };
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Read before the queries because both of them take it. `.isEnabled` is not a
  // dynamic API, so this route keeps its SSG entry; a preview request carries
  // the bypass cookie and skips that entry to get here.
  const { isEnabled: isPreview } = await draftMode();
  // This route is its own render, so it reads the flags itself rather than
  // inheriting the home page's. That is one cached lookup, not a second query.
  const [blog, allBlogs, flags] = await Promise.all([
    getBlogBySlug(slug, isPreview),
    // Preview too, so "More to read" under a draft lists the other drafts
    // rather than a public shelf the previewer cannot compare against.
    getBlogs(isPreview),
    getFlags(),
  ]);

  if (!blog) notFound();

  const moreBlogs = allBlogs.filter((b) => b.slug !== slug);
  // With the section switched off there is no `#blogs` on the home page to land
  // on. The way back still has to exist — a post is reachable by direct link —
  // so it drops the dead fragment rather than the whole affordance.
  const showBlogs = flagValue(flags, FLAG_KEYS.SECTION_BLOGS);

  return (
    <ThemeProvider>
      <MotionProvider>
      <div className="min-h-screen bg-background text-foreground">
        <BackgroundLines />
        <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50" />

        <div className="relative z-[2]">
          {/* Back button */}
          <div className="fixed top-5 left-5 z-10">
            <Link
              href={showBlogs ? '/#blogs' : '/'}
              className="inline-flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur-sm border border-border px-3.5 py-1.5 text-xs font-medium text-secondary hover:text-foreground transition-colors"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </Link>
          </div>

          {/* Cover image */}
          <div className="pt-16 px-5 sm:px-8 md:px-12">
            <div className="relative mx-auto max-w-3xl h-48 sm:h-56 md:h-72 rounded-2xl overflow-hidden">
              {blog.image ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={blog.image}
                    alt={blog.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                </>
              ) : (
                <div className={`w-full h-full bg-gradient-to-br ${blog.color}`} />
              )}
            </div>
          </div>

          {/* Content area */}
          <div className="relative mx-auto max-w-2xl px-5 sm:px-6 mt-8">
            {/* Title */}
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight tracking-tight">
              {blog.title}
            </h1>

            {blog.description && (
              <p className="mt-3 text-base text-secondary leading-relaxed">
                {blog.description}
              </p>
            )}

            <hr className="mt-6 mb-8 border-border" />

            {/* Blog content */}
            <BlogContent content={blog.content} />

            {/* More blogs */}
            {moreBlogs.length > 0 && (
              <div className="mt-16 pt-8 border-t border-border">
                <h2 className="text-lg font-semibold mb-5">More to read</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {moreBlogs.map((b) => (
                    <Link
                      key={b.slug}
                      href={`/blog/${b.slug}`}
                      className="group rounded-xl border border-border bg-card overflow-hidden transition-all duration-300 hover:border-foreground/20 hover:shadow-lg"
                    >
                      <div className="relative h-28 overflow-hidden">
                        {b.image ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={b.image}
                              alt={b.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                          </>
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${b.color}`} />
                        )}
                      </div>
                      <div className="p-3.5">
                        <h3 className="font-semibold text-sm leading-snug group-hover:text-foreground transition-colors">
                          {b.title}
                        </h3>
                        <p className="mt-1 text-xs text-secondary leading-relaxed line-clamp-2">
                          {b.description}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="pb-16" />
          </div>
        </div>
      </div>
      </MotionProvider>
    </ThemeProvider>
  );
}

export const revalidate = 86400;
