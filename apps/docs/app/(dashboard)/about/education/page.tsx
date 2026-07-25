import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { EducationTable } from "./table";
import { PreviewFrame } from "@/components/preview";
import { AboutPreview } from "@/components/preview";

export default async function EducationPage() {
  const [education, paragraphs] = await Promise.all([
    prisma.education.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.aboutParagraph.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div className="view">
      <PageHeader
        eyebrow="section 02"
        title="Education"
        description="Schools and degrees listed alongside the about section's bio."
      />
      <EducationTable entries={education.map(e => ({ id: e.id, institution: e.institution, location: e.location, degree: e.degree, scoreType: e.scoreType, score: e.score, scoreTotal: e.scoreTotal, startYear: e.startYear, endYear: e.endYear, sortOrder: e.sortOrder }))} />
      <PreviewFrame label="About Preview">
        <AboutPreview
          paragraphs={paragraphs.map(p => p.content)}
          education={education.map(e => ({
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
      </PreviewFrame>
    </div>
  );
}
