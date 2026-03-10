"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { createProject, updateProject } from "@/lib/actions/projects";
import { IconPlus, IconTrash, IconArrowUp, IconArrowDown } from "@tabler/icons-react";

interface Bullet { id?: string; content: string; sortOrder: number }
interface ProjectData {
  id: string; title: string; summary: string;
  github: string | null; live: string | null; images: string[];
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
  const [images, setImages] = useState<string[]>(project?.images?.length ? project.images : [""]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(project?.skillIds || []);
  const [bullets, setBullets] = useState<Bullet[]>(project?.bullets || [{ content: "", sortOrder: 0 }]);

  const handleSubmit = () => {
    const data = {
      title, summary,
      github: github || null,
      live: live || null,
      images: images.filter(Boolean),
      skillIds: selectedSkills,
      bullets: bullets.map((b, i) => ({ ...b, sortOrder: i })),
    };
    startTransition(async () => {
      if (isEditing) await updateProject(project.id, data);
      else await createProject(data);
      router.push("/projects");
    });
  };

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Project" : "New Project"} />
      <Card>
        <div className="space-y-4">
          <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} required />
          <Textarea label="Summary" value={summary} onChange={e => setSummary(e.target.value)} required rows={2} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="GitHub URL" value={github} onChange={e => setGithub(e.target.value)} />
            <Input label="Live URL" value={live} onChange={e => setLive(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Image URLs</label>
            <div className="space-y-2">
              {images.map((img, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={img} onChange={e => {
                    const newImages = [...images];
                    newImages[i] = e.target.value;
                    setImages(newImages);
                  }} placeholder="https://example.com/image.png" className="flex-1" />
                  <Button variant="ghost" size="sm" className="mt-1 text-destructive"
                    onClick={() => setImages(images.filter((_, j) => j !== i))}>
                    <IconTrash size={16} />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setImages([...images, ""])}>
                <IconPlus size={14} /> Add Image
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Skills</label>
            <div className="flex flex-wrap gap-2">
              {allSkills.map(s => (
                <button key={s.id} type="button" onClick={() => toggleSkill(s.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                    selectedSkills.includes(s.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Bullet Points</label>
            <div className="space-y-3">
              {bullets.map((b, i) => (
                <div key={i} className="group relative flex gap-3 rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:border-foreground/20">
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="flex flex-col gap-0.5 mt-1">
                      <button type="button" disabled={i === 0}
                        onClick={() => {
                          const arr = [...bullets];
                          [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
                          setBullets(arr);
                        }}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed border-none bg-transparent">
                        <IconArrowUp size={14} />
                      </button>
                      <button type="button" disabled={i === bullets.length - 1}
                        onClick={() => {
                          const arr = [...bullets];
                          [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
                          setBullets(arr);
                        }}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed border-none bg-transparent">
                        <IconArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <Textarea value={b.content} onChange={e => {
                      const newBullets = [...bullets];
                      newBullets[i] = { ...b, content: e.target.value };
                      setBullets(newBullets);
                    }} placeholder="Use **bold** for highlights" rows={2} className="bg-background" />
                    {b.content && (
                      <p className="text-xs text-muted-foreground px-1">
                        {b.content.split(/(\*\*.*?\*\*)/).map((part, j) =>
                          part.startsWith("**") && part.endsWith("**")
                            ? <span key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</span>
                            : <span key={j}>{part}</span>
                        )}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground hover:text-destructive"
                    onClick={() => setBullets(bullets.filter((_, j) => j !== i))}>
                    <IconTrash size={16} />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setBullets([...bullets, { content: "", sortOrder: bullets.length }])}>
                <IconPlus size={14} /> Add Bullet
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => router.push("/projects")}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
