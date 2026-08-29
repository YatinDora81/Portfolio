'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import VT from '../common/VT';

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  image: string;
  imageOrientation: string;
  color: string;
  publishedAt?: string | Date | null;
}

const INITIAL_BLOGS = 6;

function formatDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toLowerCase();
}

function Cover({ blog }: { blog: BlogPost }) {
  if (blog.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={blog.image} alt="" loading="lazy" decoding="async" />;
  }
  return <div className={`bg-gradient-to-br ${blog.color}`} />;
}

export default function Blogs({ blogs }: { blogs: BlogPost[] }) {
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<BlogPost | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);

  const visible = showAll ? blogs : blogs.slice(0, INITIAL_BLOGS);

  useEffect(() => {
    const list = listRef.current;
    const peek = peekRef.current;
    if (!list || !peek) return;
    const canPeek =
      window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!canPeek) return;

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let s = 0.7;
    let vis = false;
    let slug: string | null = null;
    let raf: number | null = null;

    const frame = () => {
      x += (tx - x) * 0.16;
      y += (ty - y) * 0.16;
      s += ((vis ? 1 : 0.7) - s) * 0.18;
      const tilt = Math.max(-8, Math.min(8, (tx - x) * 0.1));
      peek.style.transform = `translate(${x}px,${y}px) translate(22px,-115%) rotate(${tilt}deg) scale(${s})`;
      raf = vis || Math.abs(tx - x) > 0.4 || s > 0.72 ? requestAnimationFrame(frame) : null;
    };
    const kick = () => {
      if (raf === null) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const r = list.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>('.wr') : null;
      const next = row?.dataset.slug ?? null;
      if (next && next !== slug) {
        slug = next;
        setActive(blogs.find((b) => b.slug === next) ?? null);
        s = Math.max(0.84, s - 0.12);
      }
      if (next && !vis) {
        vis = true;
        x = tx;
        y = ty;
        peek.classList.add('on');
      }
      if (!next && vis) {
        vis = false;
        peek.classList.remove('on');
      }
      kick();
    };
    const onLeave = () => {
      vis = false;
      slug = null;
      peek.classList.remove('on');
      kick();
    };

    list.addEventListener('pointermove', onMove);
    list.addEventListener('pointerleave', onLeave);
    return () => {
      list.removeEventListener('pointermove', onMove);
      list.removeEventListener('pointerleave', onLeave);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [blogs]);

  return (
    <section id="blogs">
      <Container className="mt-20 animate-fade-in-blur animate-delay-5">
        <SectionHeading channel="05" label="writing" title="Index." hint={`${blogs.length} posts`} />

        <div className="wi" ref={listRef}>
          <div className="wpeek" ref={peekRef} aria-hidden="true">
            {active && (
              <VT name={`post-${active.slug}-cover`}>
                <span className="wpeek-img">
                  <Cover blog={active} />
                </span>
              </VT>
            )}
          </div>

          {visible.map((blog) => {
            const date = formatDate(blog.publishedAt);
            return (
              <Link key={blog.slug} href={`/blog/${blog.slug}`} className="wr" data-slug={blog.slug}>
                <span className="dt mono">{date ?? ''}</span>
                <span>
                  <VT name={`post-${blog.slug}-title`}>
                    <span className="t">{blog.title}</span>
                  </VT>
                  {blog.description && <span className="meta mono">{blog.description}</span>}
                </span>
                <span className="arr mono" aria-hidden="true">
                  ↗
                </span>
                <span className="icov" aria-hidden="true">
                  <Cover blog={blog} />
                </span>
              </Link>
            );
          })}
        </div>

        <p className="eol mono">
          end of index · {blogs.length} {blogs.length === 1 ? 'post' : 'posts'}
        </p>

        {!showAll && blogs.length > INITIAL_BLOGS && (
          <button type="button" className="show-more" onClick={() => setShowAll(true)}>
            Show more posts
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </Container>
    </section>
  );
}
