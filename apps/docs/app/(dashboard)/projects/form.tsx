"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { createProject, updateProject } from "@/lib/actions/projects";
import { publishSite } from "@/lib/actions/publish";
import {
  IconPlus, IconTrash, IconChevronUp, IconChevronDown, IconCheck, IconAlertTriangle,
} from "@tabler/icons-react";

interface Bullet { id?: string; content: string; sortOrder: number }
interface ProjectData {
  id: string; title: string; summary: string;
  github: string | null; live: string | null; logoUrl: string | null; images: string[];
  skillIds: string[]; bullets: Bullet[];
}

export function ProjectForm({ project, allSkills }: {
  project?: ProjectData;
  allSkills: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEditing = !!project;

  const [title, setTitle] = useState(project?.title || "");
  const [summary, setSummary] = useState(project?.summary || "");
  const [github, setGithub] = useState(project?.github || "");
  const [live, setLive] = useState(project?.live || "");
  const [logoUrl, setLogoUrl] = useState(project?.logoUrl || "");
  const [images, setImages] = useState<string[]>(project?.images?.length ? project.images : [""]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(project?.skillIds || []);
  const [bullets, setBullets] = useState<Bullet[]>(project?.bullets || [{ content: "", sortOrder: 0 }]);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);

  // Which submit button was pressed. A ref, not state: the click lands in the
  // same event as the submit, so state set here would still be stale by the
  // time the handler reads it.
  const wantPublish = useRef(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const publish = wantPublish.current;
    const data = {
      title, summary,
      github: github || null,
      live: live || null,
      logoUrl: logoUrl || null,
      images: images.filter(Boolean),
      skillIds: selectedSkills,
      bullets: bullets.map((b, i) => ({ ...b, sortOrder: i })),
    };
    startTransition(async () => {
      if (isEditing) await updateProject(project.id, data);
      else await createProject(data);
      if (publish) {
        const res = await publishSite();
        if (!res.ok) {
          // Decision 5: the project is saved. A publish that fails is a separate,
          // retryable failure — it never undoes the write, so hold the page and
          // name the reason rather than navigating away in silence.
          setPubError(res.error ?? "Could not reach the site.");
          setBusy(null);
          return;
        }
      }
      router.push("/projects");
    });
  };

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 05"
        title={isEditing ? "Edit project" : "New project"}
        description="Title and summary are what the card shows; bullets open up underneath it."
      />

      {/* A real <form>: without one, the `required` attributes below were inert
          and a blank title reached the server action. */}
      <form onSubmit={handleSubmit}>
      <Card>
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} required />
        <Textarea
          label="Summary"
          value={summary}
          onChange={e => setSummary(e.target.value)}
          required
          rows={2}
          hint="One or two lines — this is the tagline under the project title."
        />

        <div className="f-row">
          <Input label="GitHub URL" mono value={github} onChange={e => setGithub(e.target.value)} placeholder="https://github.com/…" />
          <Input label="Live URL" mono value={live} onChange={e => setLive(e.target.value)} placeholder="https://…" />
        </div>

        <Input
          label="Logo URL"
          mono
          value={logoUrl}
          onChange={e => setLogoUrl(e.target.value)}
          placeholder="/logos/my-project.png or https://…"
          hint="Optional. Shown as the mark on the project cover."
        />

        {/* ---- images ---- */}
        <div className="f">
          <label>Image URLs</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {images.map((img, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="row-i">{String(i + 1).padStart(2, "0")}</span>
                <input
                  className="in mono"
                  style={{ flex: 1, minWidth: 0 }}
                  value={img}
                  onChange={e => {
                    const newImages = [...images];
                    newImages[i] = e.target.value;
                    setImages(newImages);
                  }}
                  placeholder="https://example.com/image.png"
                />
                <button
                  type="button"
                  className="ibtn warn"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                >
                  <IconTrash size={14} stroke={1.5} />
                </button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setImages([...images, ""])}>
                <IconPlus size={14} /> Add image
              </Button>
            </div>
          </div>
          <div className="f-hint">The first image becomes the card cover.</div>
        </div>

        {/* ---- skills ---- */}
        <div className="f">
          <label>Skills</label>
          <div className="pskills">
            {allSkills.map(s => {
              const on = selectedSkills.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSkill(s.id)}
                  style={{ padding: 0, borderRadius: 99 }}
                >
                  <span className={on ? "chip amb" : "chip off"}>
                    {on && <IconCheck size={11} stroke={2} />}
                    {s.name}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="f-hint">
            {selectedSkills.length} selected — these render as the stack chips on the card.
          </div>
        </div>

        {/* ---- bullets ---- */}
        <div className="f">
          <label>Bullet points</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {bullets.map((b, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "10px 11px",
                  border: "1px solid var(--line2)",
                  borderRadius: "var(--r2)",
                  background: "var(--bg1)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, paddingTop: 2 }}>
                  <span className="row-i" style={{ width: "auto" }}>{String(i + 1).padStart(2, "0")}</span>
                  <button
                    type="button"
                    className="ibtn"
                    disabled={i === 0}
                    aria-label="Move bullet up"
                    onClick={() => {
                      const arr = [...bullets];
                      [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
                      setBullets(arr);
                    }}
                  >
                    <IconChevronUp size={13} stroke={1.5} />
                  </button>
                  <button
                    type="button"
                    className="ibtn"
                    disabled={i === bullets.length - 1}
                    aria-label="Move bullet down"
                    onClick={() => {
                      const arr = [...bullets];
                      [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
                      setBullets(arr);
                    }}
                  >
                    <IconChevronDown size={13} stroke={1.5} />
                  </button>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <textarea
                    className="ta"
                    rows={2}
                    style={{ minHeight: 64, background: "var(--card)" }}
                    value={b.content}
                    onChange={e => {
                      const newBullets = [...bullets];
                      newBullets[i] = { ...b, content: e.target.value };
                      setBullets(newBullets);
                    }}
                    placeholder="Use **bold** for highlights"
                  />
                  {b.content && (
                    <p className="f-hint" style={{ marginTop: 6, lineHeight: 1.5 }}>
                      {b.content.split(/(\*\*.*?\*\*)/).map((part, j) =>
                        part.startsWith("**") && part.endsWith("**")
                          ? <b key={j} style={{ color: "var(--ink)", fontWeight: 600 }}>{part.slice(2, -2)}</b>
                          : <span key={j}>{part}</span>
                      )}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  className="ibtn warn"
                  aria-label={`Remove bullet ${i + 1}`}
                  onClick={() => setBullets(bullets.filter((_, j) => j !== i))}
                >
                  <IconTrash size={14} stroke={1.5} />
                </button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBullets([...bullets, { content: "", sortOrder: bullets.length }])}
              >
                <IconPlus size={14} /> Add bullet
              </Button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 4,
            paddingTop: 14,
            borderTop: "1px solid var(--line2)",
          }}
        >
          {pubError ? (
            <>
              <span
                className="hint"
                style={{ flex: 1, minWidth: 200, color: "var(--bad)", lineHeight: 1.5 }}
              >
                <IconAlertTriangle size={14} stroke={1.6} style={{ flexShrink: 0 }} />
                <span>
                  The project is saved. Publishing failed ({pubError}) — retry with Publish, top right.
                </span>
              </span>
              <Button type="button" variant="ghost" onClick={() => router.push("/projects")}>
                Back to projects
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => router.push("/projects")}>Cancel</Button>
              <Button
                variant="outline"
                type="submit"
                disabled={pending}
                onClick={() => { wantPublish.current = false; setBusy("save"); }}
              >
                {pending && busy === "save" ? "Saving…" : isEditing ? "Update project" : "Create project"}
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
      </Card>
      </form>
    </div>
  );
}
