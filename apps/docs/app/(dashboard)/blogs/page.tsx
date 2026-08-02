import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteBlog, toggleBlogVisibility } from "@/lib/actions/blogs";
import {
  IconPlus, IconPencil, IconArrowUpRight, IconAlertTriangle, IconPhotoOff,
} from "@tabler/icons-react";
import { Switch } from "@/components/ui/switch";
import { PreviewFrame, BlogsPreview } from "@/components/preview";
import { cn, cdnUrl } from "@/lib/utils";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Rough reading time, same 200 wpm rule the site uses. */
const readMins = (content: string) =>
  Math.max(1, Math.round(content.trim().split(/\s+/).filter(Boolean).length / 200));

export default async function BlogsPage() {
  const blogs = await prisma.blog.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

  const live = blogs.filter(b => b.show);
  const drafts = blogs.filter(b => !b.show);
  const groups = [
    { key: "live", title: "live on the site", rows: live },
    { key: "draft", title: "drafts · not reachable", rows: drafts },
  ].filter(g => g.rows.length > 0);

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 06"
        title="Blogs"
        description="Posts on the portfolio. A live post is reachable at /blog/<slug>; a draft exists only here."
      >
        <Link href="/blogs/new">
          <Button size="sm"><IconPlus size={14} /> Add blog</Button>
        </Link>
      </PageHeader>

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">06</span>
        <div className="sec-anchor">
          <a href={`${SITE}/#blogs`} target="_blank" rel="noreferrer">
            #blogs <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        {/* Blogs is the one section whose emptiness is felt elsewhere: the
            navbar link and the terminal's `blogs` command are both derived. */}
        <div className="sec-reach">
          <span className="chip">also adds or removes the navbar link</span>
          <span className="chip">also the terminal&rsquo;s <code>blogs</code> command</span>
        </div>
      </div>

      {live.length === 0 && (
        <div className="ico-warn">
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>Nothing is published, so section 06 does not exist right now</b>
            With zero visible posts the site drops the whole Blogs section, removes{" "}
            <code>Blogs</code> from the navbar, and the About terminal stops offering{" "}
            <code>blogs</code> in <code>help</code>, <code>ls</code> and Tab-completion.
            {drafts.length > 0 && <> Flip one of the {drafts.length} draft{drafts.length === 1 ? "" : "s"} below to bring all three back.</>}
          </div>
        </div>
      )}

      <Card flush className="wk-in">
        <CardHead title="Posts" count={blogs.length} />

        {blogs.length > 0 && (
          <div className="wk-meter">
            <div className="wk-fig"><b className={live.length ? undefined : "q"}>{live.length}</b><span>live</span></div>
            <div className="wk-fig"><b className="q">{drafts.length}</b><span>drafts</span></div>
            <div className="wk-fig">
              <b className="q">{live.reduce((n, b) => n + readMins(b.content), 0)}</b>
              <span>min of published reading</span>
            </div>
          </div>
        )}

        {blogs.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconPencil size={18} stroke={1.5} /></div>
            <b>No posts written yet</b>
            <span>Section 06 and the navbar&rsquo;s Blogs link only appear once a post is live.</span>
            <Link href="/blogs/new">
              <Button size="sm"><IconPlus size={14} /> Write the first post</Button>
            </Link>
          </div>
        ) : (
          <div className="card-b" style={{ paddingTop: 12 }}>
            {groups.map((g, gi) => (
              <div key={g.key} style={gi === groups.length - 1 ? undefined : { marginBottom: 18 }}>
                <div className="skill-cat-h">
                  <div className="skill-cat-t">{g.title}</div>
                  <div className="skill-cat-n">/ {String(g.rows.length).padStart(2, "0")}</div>
                </div>

                <div className="rows" style={{ border: "1px solid var(--line2)", borderRadius: "var(--r2)", overflow: "hidden" }}>
                  {g.rows.map((b) => (
                    <div key={b.id} className={cn("row", !b.show && "dimmed")}>
                      {/* The card art the section leads with — a post with no
                          image draws a flat colour block on the site, and that
                          is worth seeing before it ships. */}
                      {b.image ? (
                        <span
                          className="blg-thumb"
                          style={{ backgroundImage: `url("${cdnUrl(b.image)}")` }}
                          title={`${b.imageOrientation} cover`}
                        />
                      ) : (
                        <span className="blg-thumb none" title="No cover image — the card falls back to its colour">
                          <IconPhotoOff size={13} stroke={1.4} />
                        </span>
                      )}

                      <div className="row-main">
                        <div className="row-t">{b.title}</div>
                        <div className="row-m" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                          /blog/{b.slug} · {fmtDate(b.publishedAt)} · {readMins(b.content)} min
                        </div>
                      </div>

                      <div className="row-acts">
                        {b.show && (
                          <a
                            className="ibtn"
                            href={`${SITE}/blog/${b.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${b.title} on the site`}
                            title="Open on the site"
                          >
                            <IconArrowUpRight size={14} stroke={1.5} className="nudge" />
                          </a>
                        )}
                        <Switch
                          checked={b.show}
                          onChange={async (val) => { "use server"; await toggleBlogVisibility(b.id, val); }}
                        />
                        <Link href={`/blogs/${b.id}`} className="ibtn" aria-label={`Edit ${b.title}`}>
                          <IconPencil size={13} stroke={1.5} />
                        </Link>
                        <DeleteButton label={`"${b.title}"`} onDelete={async () => { "use server"; await deleteBlog(b.id); }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <PreviewFrame label="Blogs Preview (visible only)">
        <BlogsPreview
          blogs={live.map(b => ({
            title: b.title,
            description: b.description,
            image: b.image,
            imageOrientation: b.imageOrientation,
          }))}
        />
      </PreviewFrame>
    </div>
  );
}
