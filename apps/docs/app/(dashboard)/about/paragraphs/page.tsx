import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { AboutParagraphsTable } from "./table";
import { StagedAboutPreview } from "@/components/preview/staged";

export default async function AboutParagraphsPage() {
  const [paragraphs, education, experiences] = await Promise.all([
    prisma.aboutParagraph.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.education.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    // Only for the paragraphs' company marks — the site reuses the same logos.
    prisma.experience.findMany({ select: { company: true, logoUrl: true } }),
  ]);
  return (
    <div className="view">
      <PageHeader
        eyebrow="section 02"
        title="About paragraphs"
        description="The bio copy in the about section. Wrap text in **double asterisks** to bold it."
      />
      <AboutParagraphsTable paragraphs={paragraphs.map(p => ({ id: p.id, content: p.content, sortOrder: p.sortOrder }))} />
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
