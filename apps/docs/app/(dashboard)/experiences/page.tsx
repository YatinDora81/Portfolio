import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteExperience } from "@/lib/actions/experiences";
import { IconPlus, IconEdit } from "@tabler/icons-react";
import { PreviewFrame, ExperiencePreview } from "@/components/preview";

export default async function ExperiencesPage() {
  const experiences = await prisma.experience.findMany({
    orderBy: { sortOrder: "asc" },
    include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { name: true } } },
  });

  return (
    <div>
      <PageHeader title="Experience" description="Work experience entries">
        <Link href="/experiences/new">
          <Button size="sm"><IconPlus size={16} /> Add Experience</Button>
        </Link>
      </PageHeader>
      <div className="space-y-4">
        {experiences.map((exp) => (
          <Card key={exp.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{exp.company}</h3>
                  {exp.isCurrent && <Badge variant="success">Current</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{exp.position}</p>
                <p className="text-xs text-muted-foreground mt-1">{exp.location} · {exp.startDate} - {exp.endDate}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {exp.skills.map((s) => (
                    <Badge key={s.name} variant="outline">{s.name}</Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{exp.bullets.length} bullet points</p>
              </div>
              <div className="flex gap-1">
                <Link href={`/experiences/${exp.id}`}>
                  <Button variant="ghost" size="sm"><IconEdit size={16} /></Button>
                </Link>
                <DeleteButton label={`"${exp.company}"`} onDelete={async () => { "use server"; await deleteExperience(exp.id); }} />
              </div>
            </div>
          </Card>
        ))}
        {experiences.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">No experiences yet</Card>
        )}
      </div>
      <PreviewFrame label="Experience Preview">
        <ExperiencePreview experiences={experiences.map(exp => ({ company: exp.company, position: exp.position, location: exp.location, startDate: exp.startDate, endDate: exp.endDate, isCurrent: exp.isCurrent, bullets: exp.bullets.map(b => b.content), technologies: exp.skills.map(s => s.name) }))} />
      </PreviewFrame>
    </div>
  );
}
