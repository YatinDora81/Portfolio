"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { createExperience, updateExperience } from "@/lib/actions/experiences";
import { IconPlus, IconTrash, IconArrowUp, IconArrowDown } from "@tabler/icons-react";

interface Bullet { id?: string; content: string; sortOrder: number }
interface ExperienceData {
  id: string; company: string; position: string; location: string;
  startDate: string; endDate: string; isCurrent: boolean;
  website: string | null; skillIds: string[]; bullets: Bullet[];
}

export function ExperienceForm({ experience, allSkills }: {
  experience?: ExperienceData;
  allSkills: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEditing = !!experience;

  const [company, setCompany] = useState(experience?.company || "");
  const [position, setPosition] = useState(experience?.position || "");
  const [location, setLocation] = useState(experience?.location || "");
  const [startDate, setStartDate] = useState(experience?.startDate || "");
  const [endDate, setEndDate] = useState(experience?.endDate || "");
  const [isCurrent, setIsCurrent] = useState(experience?.isCurrent || false);
  const [website, setWebsite] = useState(experience?.website || "");
  const [selectedSkills, setSelectedSkills] = useState<string[]>(experience?.skillIds || []);
  const [bullets, setBullets] = useState<Bullet[]>(experience?.bullets || [{ content: "", sortOrder: 0 }]);

  const handleSubmit = () => {
    const data = {
      company, position, location, startDate, endDate, isCurrent,
      website: website || null,
      skillIds: selectedSkills,
      bullets: bullets.map((b, i) => ({ ...b, sortOrder: i })),
    };
    startTransition(async () => {
      if (isEditing) await updateExperience(experience.id, data);
      else await createExperience(data);
      router.push("/experiences");
    });
  };

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  return (
    <div>
      <PageHeader title={isEditing ? "Edit Experience" : "New Experience"} />
      <Card>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Company" value={company} onChange={e => setCompany(e.target.value)} required />
            <Input label="Position" value={position} onChange={e => setPosition(e.target.value)} required />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Location" value={location} onChange={e => setLocation(e.target.value)} required />
            <Input label="Start Date" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="e.g. July 2025" required />
            <Input label="End Date" value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="e.g. Present" required />
          </div>
          <div className="flex items-center gap-4">
            <Input label="Website (optional)" value={website} onChange={e => setWebsite(e.target.value)} className="flex-1" />
            <label className="flex items-center gap-2 mt-6 text-sm cursor-pointer">
              <input type="checkbox" checked={isCurrent} onChange={e => setIsCurrent(e.target.checked)} />
              Current position
            </label>
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
          <Button variant="outline" onClick={() => router.push("/experiences")}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
