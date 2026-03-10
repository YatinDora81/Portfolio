import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBlogBySlug, getBlogs } from '@/lib/data';
import { ThemeProvider } from '@/components/common/ThemeProvider';
import BackgroundLines from '@/components/common/BackgroundLines';
import BlogContent from './BlogContent';

export default async function BlogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [blog, allBlogs] = await Promise.all([getBlogBySlug(slug), getBlogs()]);

  if (!blog) notFound();

  const moreBlogs = allBlogs.filter((b) => b.slug !== slug);

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <BackgroundLines />
        <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50 backdrop-blur-[1px]" />

        <div className="relative z-[2]">
          {/* Back button */}
          <div className="fixed top-5 left-5 z-10">
            <Link
              href="/#blogs"
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
    </ThemeProvider>
  );
}

export const revalidate = 86400;
