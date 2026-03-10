import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteBlog, toggleBlogVisibility } from "@/lib/actions/blogs";
import { IconPlus, IconEdit } from "@tabler/icons-react";
import { Switch } from "@/components/ui/switch";
import { PreviewFrame, BlogsPreview } from "@/components/preview";

export default async function BlogsPage() {
  const blogs = await prisma.blog.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <PageHeader title="Blogs" description="Blog posts on the portfolio — toggle visibility to show/hide">
        <Link href="/blogs/new">
          <Button size="sm"><IconPlus size={16} /> Add Blog</Button>
        </Link>
      </PageHeader>
      <div className="space-y-3">
        {blogs.map((b) => (
          <Card key={b.id} className={`p-4 ${!b.show ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{b.title}</h3>
                  {!b.show && <Badge variant="outline">Hidden</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{b.description}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline">{b.slug}</Badge>
                  <Badge variant="outline">{b.imageOrientation}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <Switch checked={b.show} onChange={async (val) => { "use server"; await toggleBlogVisibility(b.id, val); }} />
                <Link href={`/blogs/${b.id}`}>
                  <Button variant="ghost" size="sm"><IconEdit size={16} /></Button>
                </Link>
                <DeleteButton label={`"${b.title}"`} onDelete={async () => { "use server"; await deleteBlog(b.id); }} />
              </div>
            </div>
          </Card>
        ))}
        {blogs.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">No blogs yet</Card>
        )}
      </div>
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
