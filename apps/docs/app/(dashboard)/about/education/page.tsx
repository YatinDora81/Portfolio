import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { EducationTable } from "./table";
import { StagedAboutPreview } from "@/components/preview/staged";

export default async function EducationPage() {
  const [education, paragraphs, experiences] = await Promise.all([
    prisma.education.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.aboutParagraph.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    // Only for the paragraphs' company marks — the site reuses the same logos.
    prisma.experience.findMany({ select: { company: true, logoUrl: true } }),
  ]);
  return (
    <div className="view">
      <PageHeader
        eyebrow="section 02"
        title="Education"
        description="Schools and degrees listed alongside the about section's bio."
      />
      <EducationTable entries={education.map(e => ({ id: e.id, institution: e.institution, location: e.location, degree: e.degree, scoreType: e.scoreType, score: e.score, scoreTotal: e.scoreTotal, startYear: e.startYear, endYear: e.endYear, sortOrder: e.sortOrder }))} />
      <StagedAboutPreview
        paragraphs={paragraphs.map(p => ({ id: p.id, content: p.content }))}
        experiences={experiences}
        education={education.map(e => ({
          id: e.id,
          institution: e.institution,
          degree: e.degree,
          location: e.location,
          scoreType: e.scoreType,
          score: e.score,
          scoreTotal: e.scoreTotal,
          startYear: e.startYear,
          endYear: e.endYear,
        }))}
      />
    </div>
  );
}
