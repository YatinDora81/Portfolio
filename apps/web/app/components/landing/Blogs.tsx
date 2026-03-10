'use client';

import { useState } from 'react';
import Link from 'next/link';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  image: string;
  imageOrientation: string;
  color: string;
}

const imageHeightMap: Record<string, string[]> = {
  LANDSCAPE: ['h-44', 'h-28', 'h-36'],
  PORTRAIT: ['h-52', 'h-48'],
  SQUARE: ['h-32', 'h-40'],
};

function getImageHeight(orientation: string, index: number): string {
  const heights = imageHeightMap[orientation] || imageHeightMap.LANDSCAPE!;
  return heights[index % heights.length]!;
}

function BlogCard({ blog, index }: { blog: BlogPost; index: number }) {
  const imageHeight = getImageHeight(blog.imageOrientation, index);
  return (
    <Link
      href={`/blog/${blog.slug}`}
      className="group block w-full text-left rounded-xl border border-border bg-card overflow-hidden transition-all duration-300 hover:border-foreground/20 hover:shadow-lg cursor-pointer"
    >
      <div className={`relative overflow-hidden ${imageHeight}`}>
        {blog.image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blog.image}
              alt={blog.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </>
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${blog.color}`} />
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm leading-snug group-hover:text-foreground transition-colors">
          {blog.title}
        </h3>
        <p className="mt-1.5 text-xs text-secondary leading-relaxed">
          {blog.description}
        </p>
        <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-secondary group-hover:text-foreground transition-colors font-medium">
          Read article
          <svg className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </div>
    </Link>
  );
}

const INITIAL_BLOGS = 4;

export default function Blogs({ blogs }: { blogs: BlogPost[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? blogs : blogs.slice(0, INITIAL_BLOGS);

  const col1 = visible.filter((_, i) => i % 2 === 0);
  const col2 = visible.filter((_, i) => i % 2 === 1);

  return (
    <section id="blogs">
      <Container className="mt-20 animate-fade-in-blur animate-delay-5">
        <SectionHeading subHeading="Writing" heading="Blogs" />
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-4">
            {col1.map((blog, i) => (
              <div key={blog.slug} className={showAll && i >= INITIAL_BLOGS / 2 ? 'animate-fade-in-blur' : ''} style={showAll && i >= INITIAL_BLOGS / 2 ? { animationDelay: `${(i - INITIAL_BLOGS / 2) * 120}ms` } : {}}>
                <BlogCard blog={blog} index={i * 2} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            {col2.map((blog, i) => (
              <div key={blog.slug} className={showAll && i >= INITIAL_BLOGS / 2 ? 'animate-fade-in-blur' : ''} style={showAll && i >= INITIAL_BLOGS / 2 ? { animationDelay: `${(i - INITIAL_BLOGS / 2) * 120 + 60}ms` } : {}}>
                <BlogCard blog={blog} index={i * 2 + 1} />
              </div>
            ))}
          </div>
        </div>
        {!showAll && blogs.length > INITIAL_BLOGS && (
          <button
            onClick={() => setShowAll(true)}
            className="mt-6 mx-auto flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-secondary transition-all duration-200 hover:border-foreground/30 hover:text-foreground cursor-pointer"
          >
            Show More Blogs
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        )}
      </Container>
    </section>
  );
}
