"use client";

import { cdnUrl } from "@/lib/utils";
import { DIM, FAINT, MONO, SectionLabel } from "./frame";

// ─── Blogs Preview ───────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/Blogs.tsx: two masonry columns fed by
// index parity, cards whose image height comes from the post's orientation, a
// "Read article" chevron under the copy, and the "Show More Blogs" button that
// only appears past the fourth post.

interface BlogData {
  title: string;
  description: string;
  image?: string;
  imageOrientation?: string;
}

/**
 * `imageHeightMap` from the real component, at preview scale (~40%). The
 * per-orientation rotation is what makes the two columns stagger, so the
 * lengths — 3 landscape, 2 portrait, 2 square — matter as much as the values.
 */
const IMAGE_HEIGHTS: Record<string, number[]> = {
  LANDSCAPE: [70, 45, 58],
  PORTRAIT: [84, 78],
  SQUARE: [52, 64],
};

function imageHeight(orientation: string | undefined, index: number): number {
  const heights = IMAGE_HEIGHTS[orientation ?? ""] ?? IMAGE_HEIGHTS.LANDSCAPE!;
  return heights[index % heights.length]!;
}

/** The site renders four, then hides the rest behind the button. So does this. */
const INITIAL_BLOGS = 4;

function BlogCard({ blog, index }: { blog: BlogData; index: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#171717]">
      <div className="relative overflow-hidden" style={{ height: imageHeight(blog.imageOrientation, index) }}>
        {blog.image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cdnUrl(blog.image)} alt={blog.title} className="size-full object-cover" />
            {/* the card's dark wash — from-black/40 to transparent, bottom up */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to top, rgba(0,0,0,0.4), transparent)" }}
            />
          </>
        ) : (
          // No cover: the site falls back to the post's own gradient, which the
          // preview isn't given — a muted card-to-border wash stands in.
          <div className="size-full" style={{ background: "linear-gradient(135deg, #262626, #171717)" }} />
        )}
      </div>
      <div className="p-2.5">
        <h4 className="line-clamp-2 text-[11px] font-semibold leading-snug text-[#fafafa]">
          {blog.title || "Untitled post"}
        </h4>
        {/* Blogs.tsx:54 / :57 — both are `.text-secondary`, not muted-foreground */}
        <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed" style={{ color: DIM }}>{blog.description}</p>
        <span className="mt-2 inline-flex items-center gap-0.5 text-[8px] font-medium" style={{ color: DIM }}>
          Read article
          <svg className="size-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </div>
    </div>
  );
}

export function BlogsPreview({ blogs }: { blogs: BlogData[] }) {
  const visible = blogs.slice(0, INITIAL_BLOGS);

  // Same split the site uses: evens down the left column, odds down the right,
  // each card keeping its ORIGINAL index so the height rotation lines up.
  const col1 = visible.filter((_, i) => i % 2 === 0);
  const col2 = visible.filter((_, i) => i % 2 === 1);

  return (
    <div className="@container">
      <SectionLabel sub="Writing" main="Blogs" />

      {blogs.length === 0 ? (
        <p
          className="rounded-xl border border-dashed border-[rgba(255,255,255,0.1)] px-3 py-4 text-center text-[10px] italic"
          style={{ color: FAINT }}
        >
          No posts live yet — the site drops the whole section.
        </p>
      ) : (
        <>
          {/* one column below the site's `sm` breakpoint, two above it */}
          <div className="grid grid-cols-2 gap-2.5 @max-[420px]:grid-cols-1">
            <div className="flex flex-col gap-2.5">
              {col1.map((blog, i) => (
                <BlogCard key={`a${i}`} blog={blog} index={i * 2} />
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              {col2.map((blog, i) => (
                <BlogCard key={`b${i}`} blog={blog} index={i * 2 + 1} />
              ))}
            </div>
          </div>

          {blogs.length > INITIAL_BLOGS && (
            <>
              <span
                className="mx-auto mt-3 flex w-fit items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.1)] px-3 py-1.5 text-[9px] font-medium"
                style={{ color: DIM }}
              >
                Show More Blogs
                <svg className="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
              <p className="mt-1.5 text-center text-[8px]" style={{ fontFamily: MONO, color: FAINT }}>
                {INITIAL_BLOGS} of {blogs.length} shown — the rest expand on click
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
