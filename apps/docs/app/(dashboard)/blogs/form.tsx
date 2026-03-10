"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { createBlog, updateBlog } from "@/lib/actions/blogs";

interface BlogData {
  id: string; slug: string; title: string; description: string;
  content: string; image: string; imageOrientation: string; color: string;
  show: boolean;
}

export function BlogForm({ blog }: { blog?: BlogData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEditing = !!blog;

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      if (isEditing) await updateBlog(blog.id, formData);
      else await createBlog(formData);
      router.push("/blogs");
    });
  };

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Blog" : "New Blog"} />
      <Card>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input name="title" label="Title" defaultValue={blog?.title || ""} required />
            <Input name="slug" label="Slug" defaultValue={blog?.slug || ""} required placeholder="e.g. my-blog-post" />
          </div>
          <Textarea name="description" label="Description" defaultValue={blog?.description || ""} required rows={2} />
          <Input name="image" label="Image URL" defaultValue={blog?.image || ""} required />
          <div className="grid grid-cols-2 gap-4">
            <Select name="imageOrientation" label="Image Orientation" defaultValue={blog?.imageOrientation || "LANDSCAPE"}
              options={[
                { value: "LANDSCAPE", label: "Landscape" },
                { value: "PORTRAIT", label: "Portrait" },
                { value: "SQUARE", label: "Square" },
              ]} />
            <Input name="color" label="Color (Tailwind gradient)" defaultValue={blog?.color || ""} required
              placeholder="e.g. from-blue-500/20 to-cyan-500/20" />
          </div>
          <Textarea name="content" label="Content (Markdown)" defaultValue={blog?.content || ""} required rows={15}
            className="font-mono text-xs" />
          <div className="flex items-center gap-2">
            <input type="hidden" name="show" value="false" />
            <label className="text-sm">
              <input type="checkbox" name="show" value="true" defaultChecked={blog?.show !== false} className="mr-2" />
              Show on portfolio
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => router.push("/blogs")}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : isEditing ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
