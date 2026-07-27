"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared/page-header";
import { createBlog, updateBlog } from "@/lib/actions/blogs";
import { publishSite } from "@/lib/actions/publish";
import { IconAlertTriangle } from "@tabler/icons-react";

interface BlogData {
  id: string; slug: string; title: string; description: string;
  content: string; image: string; imageOrientation: string; color: string;
  show: boolean;
}

export function BlogForm({ blog }: { blog?: BlogData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [show, setShow] = useState(blog?.show !== false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);
  const isEditing = !!blog;

  // Which submit button was pressed. A ref, not state: the click lands in the
  // same event as the submit, so state set here would still be stale by the
  // time the form action reads it.
  const wantPublish = useRef(false);

  const handleSubmit = (formData: FormData) => {
    const publish = wantPublish.current;
    startTransition(async () => {
      if (isEditing) await updateBlog(blog.id, formData);
      else await createBlog(formData);
      if (publish) {
        const res = await publishSite();
        if (!res.ok) {
          // Decision 5: the post is saved. A publish that fails is a separate,
          // retryable failure — it never undoes the write, so hold the page and
          // name the reason rather than navigating away in silence.
          setPubError(res.error ?? "Could not reach the site.");
          setBusy(null);
          return;
        }
      }
      router.push("/blogs");
    });
  };

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 06 · blogs"
        title={isEditing ? "Edit post" : "New post"}
        description={
          isEditing
            ? "Save keeps the change in the admin; Save & Publish also pushes it to the live site."
            : "Write the post, then decide whether it ships live or stays a draft."
        }
      />

      <Card flush>
        <CardHead title="Post" right={<span className="card-n">{isEditing ? "editing" : "draft"}</span>} />
        <div className="card-b">
          <form action={handleSubmit}>
            <div className="f-row">
              <Input name="title" label="Title" defaultValue={blog?.title || ""} required />
              <Input
                name="slug"
                label="Slug"
                mono
                defaultValue={blog?.slug || ""}
                required
                placeholder="my-blog-post"
                hint="The URL on the site — /blog/<slug>."
              />
            </div>

            <Textarea
              name="description"
              label="Description"
              defaultValue={blog?.description || ""}
              required
              rows={2}
              hint="One line — this is the card summary on the blog list."
            />

            <Input
              name="image"
              label="Image URL"
              mono
              defaultValue={blog?.image || ""}
              required
              placeholder="/blogs/cover.png"
            />

            <div className="f-row">
              <Select
                name="imageOrientation"
                label="Image Orientation"
                defaultValue={blog?.imageOrientation || "LANDSCAPE"}
                options={[
                  { value: "LANDSCAPE", label: "Landscape" },
                  { value: "PORTRAIT", label: "Portrait" },
                  { value: "SQUARE", label: "Square" },
                ]}
              />
              <Input
                name="color"
                label="Color (Tailwind gradient)"
                mono
                defaultValue={blog?.color || ""}
                required
                placeholder="from-blue-500/20 to-cyan-500/20"
              />
            </div>

            <Textarea
              name="content"
              label="Content (Markdown)"
              mono
              defaultValue={blog?.content || ""}
              required
              rows={15}
              hint="Markdown — headings, lists, code fences and links all render on the site."
            />

            <div className="f">
              <label>Visibility</label>
              <input type="hidden" name="show" value={show ? "true" : "false"} />
              <Switch checked={show} onChange={setShow} label="Show on portfolio" />
            </div>

            <div
              className="row-acts"
              style={{ justifyContent: "flex-end", gap: 8, marginTop: 4, flexWrap: "wrap" }}
            >
              {pubError ? (
                <>
                  <span
                    className="hint"
                    style={{ flex: 1, minWidth: 200, color: "var(--bad)", lineHeight: 1.5 }}
                  >
                    <IconAlertTriangle size={14} stroke={1.6} style={{ flexShrink: 0 }} />
                    <span>
                      The post is saved. Publishing failed ({pubError}) — retry with Publish, top right.
                    </span>
                  </span>
                  <Button variant="ghost" type="button" onClick={() => router.push("/blogs")}>
                    Back to posts
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" type="button" onClick={() => router.push("/blogs")}>Cancel</Button>
                  <Button
                    variant="outline"
                    type="submit"
                    disabled={pending}
                    onClick={() => { wantPublish.current = false; setBusy("save"); }}
                  >
                    {pending && busy === "save" ? "Saving…" : isEditing ? "Update" : "Create"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={pending}
                    onClick={() => { wantPublish.current = true; setBusy("publish"); }}
                  >
                    {pending && busy === "publish" ? "Saving…" : "Save & Publish"}
                  </Button>
                </>
              )}
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
