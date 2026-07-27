"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { createExperience, updateExperience } from "@/lib/actions/experiences";
import { IconPlus, IconTrash, IconChevronUp, IconChevronDown, IconTag } from "@tabler/icons-react";

interface Bullet { id?: string; content: string; sortOrder: number }
interface ExperienceData {
  id: string; company: string; position: string; location: string;
  startDate: string; endDate: string; isCurrent: boolean;
  website: string | null; logoUrl: string | null; visibleBullets: number;
  skillIds: string[]; bullets: Bullet[];
}

/** `**highlight**` runs render in the ink colour, mirroring the live site. */
function renderBullet(text: string) {
  return text.split(/\*\*(.*?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <b key={i} style={{ color: "var(--ink)", fontWeight: 600 }}>{part}</b>
      : <span key={i}>{part}</span>
  );
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
  const [logoUrl, setLogoUrl] = useState(experience?.logoUrl || "");
  const [visibleBullets, setVisibleBullets] = useState(experience?.visibleBullets ?? 4);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(experience?.skillIds || []);
  const [bullets, setBullets] = useState<Bullet[]>(experience?.bullets || [{ content: "", sortOrder: 0 }]);

  const handleSubmit = () => {
    const data = {
      company, position, location, startDate, endDate, isCurrent,
      website: website || null,
      logoUrl: logoUrl || null,
      visibleBullets,
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
    <div className="view">
      <PageHeader
        eyebrow="section 04"
        title={isEditing ? "Edit role" : "New role"}
        description="One entry on the work timeline — the header line, the period, and the bullets underneath."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card flush>
          <CardHead title="Role" />
          <div className="card-b">
            <div className="f-row">
              <Input label="Company" value={company} onChange={e => setCompany(e.target.value)} required />
              <Input label="Position" value={position} onChange={e => setPosition(e.target.value)} required />
            </div>
            <div className="f-row">
              <Input label="Location" value={location} onChange={e => setLocation(e.target.value)} required />
              <Input label="Website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" mono />
            </div>
            <div className="f-row">
              <Input label="Start date" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="e.g. July 2025" required />
              <Input label="End date" value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="e.g. Present" required />
            </div>
            <Input
              label="Logo URL"
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              placeholder="/logos/my-company.png or https://…"
              hint="Optional. Shown next to the company name on the site."
              mono
            />
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <Switch checked={isCurrent} onChange={setIsCurrent} label="Current position" />
              <span className="f-hint" style={{ marginTop: 0 }}>
                Marks the role as ongoing — the timeline dot turns amber.
              </span>
            </div>
          </div>
        </Card>

        <Card flush>
          <CardHead
            title="Bullet points"
            count={bullets.length}
            right={
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setBullets([...bullets, { content: "", sortOrder: bullets.length }])}
              >
                <IconPlus size={13} stroke={1.7} /> Add bullet
              </Button>
            }
          />

          {/* Per-role scan layer. Lives with the bullets because the number
              only means anything relative to how many there are. */}
          <div className="filters">
            <label
              htmlFor="visibleBullets"
              style={{
                fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".14em",
                textTransform: "uppercase", color: "var(--faint)",
              }}
            >
              Show first
            </label>
            <input
              id="visibleBullets"
              className="in mono"
              type="number"
              min={1}
              max={30}
              value={visibleBullets}
              onChange={(e) => setVisibleBullets(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 62, padding: "5px 8px", fontSize: 12.5 }}
            />
            <span style={{ fontSize: 12, color: "var(--faint)" }}>
              {bullets.length > visibleBullets
                ? `then the site folds the other ${bullets.length - visibleBullets} behind a “+ ${bullets.length - visibleBullets} more” toggle.`
                : "every bullet fits — the site shows no toggle for this role."}
            </span>
          </div>

          {bullets.length === 0 ? (
            <div className="empty">
              <div className="empty-ic"><IconPlus size={18} stroke={1.5} /></div>
              <b>No bullet points</b>
              <span>Add the two or three lines that describe what you shipped in this role.</span>
            </div>
          ) : (
            <div className="rows">
              {bullets.map((b, i) => (
                <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                  <div className="row-i" style={{ marginTop: 9 }}>{String(i + 1).padStart(2, "0")}</div>
                  <div className="row-main">
                    <Textarea
                      value={b.content}
                      onChange={e => {
                        const newBullets = [...bullets];
                        newBullets[i] = { ...b, content: e.target.value };
                        setBullets(newBullets);
                      }}
                      placeholder="Use **bold** for the part that should stand out"
                      rows={2}
                      style={{ minHeight: 62 }}
                    />
                    <div className="f-hint" style={{ lineHeight: 1.55 }}>
                      {b.content ? renderBullet(b.content) : "Preview appears here as you type."}
                    </div>
                  </div>
                  <div className="row-acts" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="ibtn"
                      aria-label="Move bullet up"
                      disabled={i === 0}
                      onClick={() => {
                        const arr = [...bullets];
                        [arr[i - 1], arr[i]] = [arr[i]!, arr[i - 1]!];
                        setBullets(arr);
                      }}
                    >
                      <IconChevronUp size={14} stroke={1.6} />
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      aria-label="Move bullet down"
                      disabled={i === bullets.length - 1}
                      onClick={() => {
                        const arr = [...bullets];
                        [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
                        setBullets(arr);
                      }}
                    >
                      <IconChevronDown size={14} stroke={1.6} />
                    </button>
                    <button
                      type="button"
                      className="ibtn warn"
                      aria-label="Remove bullet"
                      onClick={() => setBullets(bullets.filter((_, j) => j !== i))}
                    >
                      <IconTrash size={13} stroke={1.5} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card flush>
          <CardHead title="Skills" count={selectedSkills.length} />
          <div className="card-b">
            {allSkills.length === 0 ? (
              <div className="hint"><IconTag size={13} stroke={1.5} /> No skills defined yet — add them in section 05.</div>
            ) : (
              <>
                <div className="pskills" style={{ gap: 6 }}>
                  {allSkills.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSkill(s.id)}
                      className={cn("filt", selectedSkills.includes(s.id) && "on")}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="f-hint" style={{ marginTop: 10 }}>
                  Selected skills render as the tech chips under this role.
                </div>
              </>
            )}
          </div>
        </Card>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" type="button" onClick={() => router.push("/experiences")}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving…" : isEditing ? "Update role" : "Create role"}
          </Button>
        </div>
      </div>
    </div>
  );
}
