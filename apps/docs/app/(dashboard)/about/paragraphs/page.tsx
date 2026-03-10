import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { AboutParagraphsTable } from "./table";
import { PreviewFrame } from "@/components/preview";
import { AboutPreview } from "@/components/preview";

export default async function AboutParagraphsPage() {
  const [paragraphs, education] = await Promise.all([
    prisma.aboutParagraph.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.education.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="About Paragraphs" description="Bio text in the about section (supports **bold** markdown)" />
      <AboutParagraphsTable paragraphs={paragraphs.map(p => ({ id: p.id, content: p.content, sortOrder: p.sortOrder }))} />
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
