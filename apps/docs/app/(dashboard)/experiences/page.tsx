import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteExperience } from "@/lib/actions/experiences";
import { cn } from "@/lib/utils";
import { IconPlus, IconPencil, IconBriefcase, IconArrowUpRight } from "@tabler/icons-react";
import { PreviewFrame, ExperiencePreview } from "@/components/preview";

/** Bullets are authored with `**highlight**` — render those runs in the ink colour. */
function renderBullet(text: string) {
  return text.split(/\*\*(.*?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <b key={i} style={{ color: "var(--ink)", fontWeight: 600 }}>{part}</b>
      : <span key={i}>{part}</span>
  );
}

export default async function ExperiencesPage() {
  const experiences = await prisma.experience.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, skills: { select: { name: true } } },
  });

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 04"
        title="Experience"
        description="The work timeline — roles, periods and the bullet points that ship to the site."
      >
        <Link href="/experiences/new">
          <Button size="sm"><IconPlus size={14} stroke={1.7} /> Add role</Button>
        </Link>
      </PageHeader>

      {experiences.length === 0 ? (
        <Card flush>
          <div className="empty">
            <div className="empty-ic"><IconBriefcase size={19} stroke={1.5} /></div>
            <b>No roles on the timeline</b>
            <span>Add a position and it appears on the portfolio in order, newest first.</span>
            <Link href="/experiences/new" style={{ marginTop: 4 }}>
              <Button size="sm"><IconPlus size={14} stroke={1.7} /> Add role</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="xp">
          {experiences.map((exp) => (
            <div key={exp.id} className={cn("xp-item", exp.isCurrent && "now")}>
              <Card>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--disp)", fontWeight: 600, fontSize: "15.5px", letterSpacing: "-.01em" }}>
                      {exp.position}
                    </div>
                    <div className="row-m">
                      {exp.company}{exp.location ? ` · ${exp.location}` : ""}
                    </div>
                  </div>

                  <span
                    className={cn("chip", exp.isCurrent && "amb")}
                    style={{ marginTop: 2, flex: "none", whiteSpace: "nowrap" }}
                  >
                    {exp.isCurrent && <span className="dot" />}
                    {exp.startDate} — {exp.endDate}
                  </span>

                  <div className="row-acts">
                    {exp.website && (
                      <a
                        className="ibtn"
                        href={exp.website}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${exp.company}`}
                      >
                        <IconArrowUpRight size={14} stroke={1.5} />
                      </a>
                    )}
                    <Link className="ibtn" href={`/experiences/${exp.id}`} aria-label={`Edit ${exp.company}`}>
                      <IconPencil size={13} stroke={1.5} />
                    </Link>
                    <DeleteButton
                      label={`"${exp.company}"`}
                      sub="Deleting the role removes its bullet points too. There's no undo here."
                      onDelete={async () => { "use server"; await deleteExperience(exp.id); }}
                    />
                  </div>
                </div>

                {exp.bullets.length > 0 && (
                  <ul style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 5 }}>
                    {exp.bullets.map((b) => (
                      <li
                        key={b.id}
                        style={{ position: "relative", paddingLeft: 15, fontSize: 13, lineHeight: 1.6, color: "var(--dim)" }}
                      >
                        <span
                          style={{
                            position: "absolute", left: 2, top: ".62em", width: 4, height: 4,
                            borderRadius: 99, background: "var(--faint)",
                          }}
                        />
                        {renderBullet(b.content)}
                      </li>
                    ))}
                  </ul>
                )}

                {exp.skills.length > 0 && (
                  <div className="pskills" style={{ marginTop: 12 }}>
                    {exp.skills.map((s) => (
                      <Badge key={s.name} variant="outline">{s.name}</Badge>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      <PreviewFrame label="Experience Preview">
        <ExperiencePreview experiences={experiences.map(exp => ({ company: exp.company, position: exp.position, location: exp.location, startDate: exp.startDate, endDate: exp.endDate, isCurrent: exp.isCurrent, bullets: exp.bullets.map(b => b.content), technologies: exp.skills.map(s => s.name) }))} />
      </PreviewFrame>
    </div>
  );
}
