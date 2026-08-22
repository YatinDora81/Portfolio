"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContentStatus } from "db";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusField } from "@/components/lifecycle/status-field";
import { createBlog, updateBlog } from "@/lib/actions/blogs";
import { publishSite } from "@/lib/actions/publish";
import { scheduleProblem, transportError, utcToIstInput } from "@/lib/lifecycle";
import { IconAlertTriangle } from "@tabler/icons-react";

interface BlogData {
  id: string; slug: string; title: string; description: string;
  content: string; image: string; imageOrientation: string; color: string;
  status: ContentStatus;
  /** Stored UTC instant as ISO, or null. */
  publishAtIso: string | null;
}

export function BlogForm({ blog }: { blog?: BlogData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<ContentStatus>(blog?.status ?? "DRAFT");
  // `utcToIstInput`, not `toLocale*`, so the server's HTML and hydration produce the same attribute.
  const [publishAtIst, setPublishAtIst] = useState(
    blog?.publishAtIso ? utcToIstInput(new Date(blog.publishAtIso)) : ""
  );
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isEditing = !!blog;

  // Which submit button was pressed. A ref, not state: the click lands in the
  // same event as the submit, so state set here would still be stale by the
  // time the form action reads it.
  const wantPublish = useRef(false);

  const handleSubmit = (formData: FormData) => {
    const publish = wantPublish.current;

    // The action checks this again, because this copy can be skipped.
    const problem = scheduleProblem(status, publishAtIst);
    if (problem) {
      setSaveError(problem);
      setBusy(null);
      return;
    }
    setSaveError(null);

    startTransition(async () => {
      try {
        const res = isEditing ? await updateBlog(blog.id, formData) : await createBlog(formData);
        if (!res.ok) {
          setSaveError(res.error ?? "The post was not saved.");
          return;
        }

        if (publish) {
          const pub = await publishSite();
          if (!pub.ok) {
            // The write already landed; a failed publish never undoes it.
            setPubError(pub.error ?? "Could not reach the site.");
            return;
          }
        }
        router.push("/blogs");
      } catch (e) {
        setSaveError(transportError(e));
      } finally {
        setBusy(null);
      }
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
            : "Write the post, then choose where it sits in the lifecycle — draft, scheduled, or live."
        }
      />

      <Card flush>
        <CardHead title="Post" right={<span className="card-n">{isEditing ? "editing" : "new"}</span>} />
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

            <StatusField
              noun="post"
              status={status}
              onStatus={setStatus}
              publishAtIst={publishAtIst}
              onPublishAt={setPublishAtIst}
              error={saveError}
            />

            <div className="lc-note lc-after-field">
              This replaces the old <b>Show on portfolio</b> switch. That switch wrote a boolean
              the site has stopped reading — the column is still in the database so the lifecycle
              can be rolled back, but nothing reads it any more, and Status is now the only thing
              that decides whether a post is reachable.
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
