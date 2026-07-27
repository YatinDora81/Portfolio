import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteBlog, toggleBlogVisibility } from "@/lib/actions/blogs";
import { IconPlus, IconPencil } from "@tabler/icons-react";
import { Switch } from "@/components/ui/switch";
import { PreviewFrame, BlogsPreview } from "@/components/preview";
import { cn } from "@/lib/utils";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Rough reading time, same 200 wpm rule the site uses. */
const readMins = (content: string) =>
  Math.max(1, Math.round(content.trim().split(/\s+/).filter(Boolean).length / 200));

export default async function BlogsPage() {
  const blogs = await prisma.blog.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 06"
        title="Blogs"
        description="Posts on the portfolio. Live posts are reachable at /blog; drafts stay off the site until you flip them on."
      />

      <Card flush>
        <CardHead
          title="Posts"
          count={blogs.length}
          right={
            <Link href="/blogs/new">
              <Button size="sm"><IconPlus size={14} /> Add blog</Button>
            </Link>
          }
        />

        {blogs.length === 0 ? (
          <div className="empty">
            <div className="empty-ic"><IconPencil size={18} stroke={1.5} /></div>
            <b>No posts yet</b>
            <span>Write your first post and toggle it live when it&rsquo;s ready.</span>
            <Link href="/blogs/new">
              <Button size="sm"><IconPlus size={14} /> Add blog</Button>
            </Link>
          </div>
        ) : (
          <div className="rows">
            {blogs.map((b) => (
              <div key={b.id} className={cn("row", !b.show && "dimmed")}>
                <span className={cn("chip", b.show ? "on" : "off")}>
                  <span className="dot" />
                  {b.show ? "Live" : "Draft"}
                </span>
                <div className="row-main">
                  <div className="row-t">{b.title}</div>
                  <div className="row-m" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                    /blog/{b.slug} · {fmtDate(b.publishedAt)} · {readMins(b.content)} min
                  </div>
                </div>
                <div className="row-acts">
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
        )}
      </Card>

      <PreviewFrame label="Blogs Preview (visible only)">
        <BlogsPreview
          blogs={blogs.filter(b => b.show).map(b => ({
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
