import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { GraduationCapIcon } from '../icons';

interface EducationEntry {
  institution: string;
  location: string;
  degree: string;
  scoreType: string | null;
  score: string | null;
  scoreTotal: string | null;
  startYear: string;
  endYear: string;
}

interface AboutProps {
  paragraphs: string[];
  education: EducationEntry[];
}

function renderMarkdownBold(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="text-foreground">{part}</b>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function About({ paragraphs, education }: AboutProps) {
  return (
    <Container className="mt-16 animate-fade-in-blur animate-delay-1">
      <SectionHeading subHeading="About" heading="Who I am" />
      <div className="mt-4 space-y-4 text-secondary leading-relaxed">
        {paragraphs.map((p, i) => (
          <p key={i}>{renderMarkdownBold(p)}</p>
        ))}
      </div>

      {education.map((edu, i) => (
        <div key={i} className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-4">
          <div className="mt-0.5 text-secondary">
            <GraduationCapIcon className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold">{edu.institution}</h3>
            <p className="text-secondary text-sm">{edu.degree}</p>
            <div className="mt-1 flex items-center gap-3 text-sm text-secondary">
              {edu.score && (
                <span>
                  {edu.scoreType === 'CGPA' ? 'CGPA' : 'Percentage'}:{' '}
                  <b className="text-foreground">{edu.score}</b>
                  {edu.scoreTotal && edu.scoreType === 'CGPA' ? `/${edu.scoreTotal}` : '%'}
                </span>
              )}
              <span>{edu.startYear} - {edu.endYear}</span>
            </div>
          </div>
        </div>
      ))}
    </Container>
  );
}
