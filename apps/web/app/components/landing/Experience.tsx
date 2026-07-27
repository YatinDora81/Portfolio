import Container from '../common/Container';
import SectionHeading from '../common/SectionHeading';
import { MapPinIcon } from '@repo/ui/icons/brand';
import { skillIconMap } from '@repo/ui/icons/registry';

export interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  website: string | null;
  logoUrl: string | null;
  bullets: string[];
  technologies: string[];
}

/* Bold-lead bullets: "**scan line** rest of the detail".
   NOTE: identical to the parseBullet in landing/Projects.tsx — duplicated on
   purpose because that file is owned by another agent this pass. The Integrate
   phase should hoist one copy into a shared module. */
function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: '' };
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Absolute month index for a "July 2025"-style string; NaN when unparseable. */
function monthOrdinal(value: string): number {
  if (/present|current|now/i.test(value)) {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth();
  }
  const parts = value.trim().toLowerCase().split(/\s+/);
  const year = Number(parts[1]);
  if (!Number.isFinite(year)) return NaN;
  const token = parts[0] ?? '';
  const month = token.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(token)) : -1;
  return year * 12 + (month === -1 ? 0 : month);
}

/**
 * LinkedIn-style inclusive tenure: "July 2025" → "Present" gives "1 yr 1 mo".
 * startDate/endDate are plain strings in this schema (Experience.startDate /
 * .endDate are `String` in prisma, seeded as "July 2025" / "Present"), so this
 * parses month names rather than Date objects. Returns '' when unparseable so
 * the pill is simply omitted.
 */
function tenure(start: string, end: string, isCurrent: boolean): string {
  const from = monthOrdinal(start);
  const to = isCurrent ? monthOrdinal('present') : monthOrdinal(end);
  const months = to - from + 1;
  if (!(months > 0)) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const out: string[] = [];
  if (years) out.push(`${years} yr${years > 1 ? 's' : ''}`);
  if (rest) out.push(`${rest} mo${rest > 1 ? 's' : ''}`);
  return out.join(' ');
}

function ExperienceCard({ exp }: { exp: ExperienceData }) {
  const duration = tenure(exp.startDate, exp.endDate, exp.isCurrent);
  const endLabel = exp.isCurrent ? exp.endDate || 'Present' : exp.endDate;

  return (
    <div className="xp-card">
      <span className={exp.isCurrent ? 'xp-node live' : 'xp-node'} aria-hidden />

      <div className="xp-top">
        <div>
          <div className="xp-co">
            {exp.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={exp.logoUrl}
                alt=""
                aria-hidden
                width={24}
                height={24}
                loading="lazy"
                decoding="async"
              />
            )}
            {exp.website ? (
              <a href={exp.website} target="_blank" rel="noopener noreferrer">
                {exp.company}
              </a>
            ) : (
              <h3 className="xp-name">{exp.company}</h3>
            )}
            {exp.isCurrent && (
              <span className="xp-cur">
                <i />
                Current
              </span>
            )}
          </div>
          <p className="xp-pos">{exp.position}</p>
        </div>

        <div className="xp-when">
          <span className="dates">
            {exp.startDate} - {endLabel}
            {duration && <span className="xp-dur mono">{duration}</span>}
          </span>
          <span className="loc">
            <MapPinIcon className="" />
            {exp.location}
          </span>
        </div>
      </div>

      {/* every achievement visible — the bold lead is the scan line */}
      <ul className="bullets">
        {exp.bullets.map(parseBullet).map((bullet, i) => (
          <li key={i}>
            <i />
            <span>
              <b>{bullet.highlight}</b> {bullet.detail}
            </span>
          </li>
        ))}
      </ul>

      {exp.technologies.length > 0 && (
        <div className="xp-badges">
          {exp.technologies.map((tech) => {
            const icon = skillIconMap[tech];
            return (
              <span key={tech} className="badge skill-inner-shadow">
                {icon && <span className="bi">{icon}</span>}
                {tech}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Experience({ experiences }: { experiences: ExperienceData[] }) {
  return (
    <section id="experience">
      <Container className="mt-20 animate-fade-in-blur animate-delay-2">
        <SectionHeading subHeading="Career" heading="Experience" />
        <div className="xp-list">
          <span className="xp-rail" aria-hidden />
          {experiences.map((exp) => (
            <ExperienceCard key={`${exp.company}-${exp.startDate}`} exp={exp} />
          ))}
        </div>
      </Container>
    </section>
  );
}
