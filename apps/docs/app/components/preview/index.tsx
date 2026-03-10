import { IconEye } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// ─── Preview Frame ───────────────────────────────────────────────
// Dark-themed container that mimics the portfolio's dark mode

export function PreviewFrame({ children, label = "Portfolio Preview", className }: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("mt-6", className)}>
      <div className="flex items-center gap-2 mb-3">
        <IconEye size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">How it looks on your site</span>
      </div>
      <div
        className="rounded-xl overflow-hidden shadow-lg"
        style={{ background: '#0a0a0a', color: '#fafafa', fontFamily: "'Inter', system-ui, -apple-system, sans-serif", border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <div className="p-5 sm:p-6" style={{ color: '#fafafa' }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────

function SectionLabel({ sub, main }: { sub: string; main: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[#a3a3a3] font-medium">{sub}</p>
      <h3 className="text-base font-bold text-[#fafafa]">{main}</h3>
    </div>
  );
}

function renderBold(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <b key={i} className="text-[#fafafa]">{part}</b> : <span key={i}>{part}</span>
  );
}

// ─── Hero Preview ────────────────────────────────────────────────

interface HeroPreviewProps {
  titles: string[];
  name: string;
  tagline: string;
  intro: string;
  skills: { name: string }[];
  socialLinks: { name: string }[];
  avatarUrl?: string;
}

export function HeroPreview({ titles, name, tagline, intro, skills, socialLinks, avatarUrl }: HeroPreviewProps) {
  return (
    <div>
      {/* Avatar */}
      <div className="size-14 rounded-full bg-[#262626] border-2 border-[rgba(255,255,255,0.1)] ring-2 ring-[#262626] ring-offset-2 ring-offset-[#0a0a0a] overflow-hidden">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={name} className="size-14 object-cover" />
        ) : (
          <div className="size-14 flex items-center justify-center text-[#a3a3a3] text-xl font-bold">
            {name?.[0] || "?"}
          </div>
        )}
      </div>

      {/* Name + Title display */}
      <h2 className="mt-5 text-xl font-bold leading-snug" style={{ color: '#fafafa' }}>
        Hi, I&apos;m {name || "..."} &mdash;{" "}
        <span style={{ background: 'linear-gradient(90deg, #e2e8f0, #94a3b8, #cbd5e1, #e2e8f0)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          {titles.length > 0 ? titles[0] : "Your Title"}
        </span>
        <span style={{ color: '#737373' }}>.</span>
      </h2>

      {/* All titles list */}
      {titles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {titles.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium"
              style={{
                background: i === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
                color: i === 0 ? '#fafafa' : '#a3a3a3',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {i === 0 && <span className="mr-1.5 size-1.5 rounded-full bg-[#22c55e] animate-pulse" />}
              {t}
            </span>
          ))}
          <span className="self-center text-[10px]" style={{ color: '#737373' }}>
            &larr; rotates every 2.5s
          </span>
        </div>
      )}

      {/* Intro + skill badges */}
      <p className="mt-4 text-sm leading-relaxed" style={{ color: '#a3a3a3' }}>
        {intro || "Your intro text"}{" "}
        {skills.map((s, i) => (
          <span key={s.name}>
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium align-middle"
              style={{ border: '1px dashed rgba(255,255,255,0.15)', background: '#262626', color: '#fafafa' }}
            >
              {s.name}
            </span>
            {i < skills.length - 2 && " "}
            {i === skills.length - 2 && " and "}
          </span>
        ))}
        {tagline && <span>. {tagline}</span>}
      </p>

      {/* Buttons */}
      <div className="mt-5 flex gap-2.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
          style={{ border: '1px solid rgba(255,255,255,0.15)', background: '#0a0a0a', color: '#fafafa' }}
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          Resume / CV
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
          style={{ background: '#fafafa', color: '#0a0a0a' }}
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          Get in touch
        </span>
      </div>

      {/* Social links */}
      {socialLinks.length > 0 && (
        <div className="mt-4 flex gap-3">
          {socialLinks.map(l => (
            <span key={l.name} className="text-xs font-medium" style={{ color: '#a3a3a3' }}>{l.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── About Preview ───────────────────────────────────────────────

interface EducationEntry {
  institution: string;
  degree: string;
  location?: string;
  scoreType?: string | null;
  score?: string | null;
  scoreTotal?: string | null;
  startYear: string;
  endYear: string;
}

interface AboutPreviewProps {
  paragraphs: string[];
  education: EducationEntry[];
}

export function AboutPreview({ paragraphs, education }: AboutPreviewProps) {
  return (
    <div>
      <SectionLabel sub="About" main="Who I am" />
      <div className="space-y-2 text-xs text-[#a3a3a3] leading-relaxed">
        {paragraphs.map((p, i) => (
          <p key={i}>{renderBold(p)}</p>
        ))}
        {paragraphs.length === 0 && <p className="text-[#737373] italic">No paragraphs yet</p>}
      </div>

      {education.map((edu, i) => (
        <div key={i} className="mt-3 flex items-start gap-2.5 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] p-3">
          <span className="text-[#a3a3a3] mt-0.5 text-xs">&#127891;</span>
          <div>
            <p className="text-xs font-semibold text-[#fafafa]">{edu.institution}</p>
            <p className="text-[10px] text-[#a3a3a3]">{edu.degree}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-[#a3a3a3]">
              {edu.score && (
                <span>
                  {edu.scoreType === "CGPA" ? "CGPA" : "Percentage"}:{" "}
                  <b className="text-[#fafafa]">{edu.score}</b>
                  {edu.scoreTotal && edu.scoreType === "CGPA" ? `/${edu.scoreTotal}` : "%"}
                </span>
              )}
              <span>{edu.startYear} - {edu.endYear}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skills Preview ──────────────────────────────────────────────

export function SkillsPreview({ skills }: { skills: { name: string }[] }) {
  const visible = skills.slice(0, 24);
  const remaining = skills.length - visible.length;

  return (
    <div>
      <SectionLabel sub="Technical" main="Skills" />
      <div className="flex flex-wrap gap-2">
        {visible.map(s => (
          <div key={s.name} className="flex flex-col items-center gap-1">
            <div className="size-8 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] flex items-center justify-center">
              <span className="text-[10px] text-[#a3a3a3] font-medium">{s.name.slice(0, 2)}</span>
            </div>
            <span className="text-[8px] text-[#a3a3a3] text-center max-w-[48px] leading-tight truncate">{s.name}</span>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <p className="text-[10px] text-[#737373] mt-2">+{remaining} more skills</p>
      )}
      {skills.length === 0 && <p className="text-[10px] text-[#737373] italic">No visible skills</p>}
    </div>
  );
}

// ─── Experience Preview ──────────────────────────────────────────

interface ExperienceData {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  bullets: string[];
  technologies: string[];
}

export function ExperiencePreview({ experiences }: { experiences: ExperienceData[] }) {
  return (
    <div>
      <SectionLabel sub="Career" main="Experience" />
      <div className="space-y-4">
        {experiences.slice(0, 3).map((exp, i) => (
          <div key={i} className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#fafafa]">{exp.company}</span>
                  {exp.isCurrent && (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-[rgba(34,197,94,0.1)] px-1.5 py-0.5 text-[8px] text-[#4ade80]">
                      <span className="size-1 rounded-full bg-[#22c55e]" />
                      Current
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-[#a3a3a3]">{exp.position}</p>
              </div>
              <div className="text-right text-[10px] text-[#a3a3a3]">
                <p>{exp.startDate} - {exp.endDate}</p>
                <p>{exp.location}</p>
              </div>
            </div>

            {exp.technologies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {exp.technologies.slice(0, 6).map(t => (
                  <span key={t} className="rounded-md border border-dashed border-[rgba(255,255,255,0.12)] bg-[#262626] px-1.5 py-0.5 text-[8px] text-[#fafafa] font-medium">
                    {t}
                  </span>
                ))}
                {exp.technologies.length > 6 && (
                  <span className="text-[8px] text-[#737373]">+{exp.technologies.length - 6}</span>
                )}
              </div>
            )}

            {exp.bullets.length > 0 && (
              <ul className="mt-2 space-y-1">
                {exp.bullets.slice(0, 2).map((b, j) => {
                  const { highlight, detail } = parseBullet(b);
                  return (
                    <li key={j} className="flex gap-2 text-[10px]">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[rgba(255,255,255,0.3)]" />
                      <span className="text-[#a3a3a3] line-clamp-1">
                        <span className="text-[#fafafa] font-medium">{highlight}</span>{" "}
                        {detail}
                      </span>
                    </li>
                  );
                })}
                {exp.bullets.length > 2 && (
                  <li className="text-[8px] text-[#737373] ml-3">+{exp.bullets.length - 2} more bullets</li>
                )}
              </ul>
            )}
          </div>
        ))}
        {experiences.length > 3 && (
          <p className="text-[10px] text-[#737373]">+{experiences.length - 3} more experiences</p>
        )}
        {experiences.length === 0 && <p className="text-[10px] text-[#737373] italic">No experiences yet</p>}
      </div>
    </div>
  );
}

// ─── Projects Preview ────────────────────────────────────────────

interface ProjectData {
  title: string;
  summary: string;
  bullets: string[];
  technologies: string[];
  github?: string | null;
  live?: string | null;
}

export function ProjectsPreview({ projects }: { projects: ProjectData[] }) {
  return (
    <div>
      <SectionLabel sub="Work" main="Projects" />
      <div className="space-y-3">
        {projects.slice(0, 3).map((p, i) => (
          <div key={i} className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#fafafa]">{p.title}</span>
              <div className="flex items-center gap-2 text-[10px] text-[#a3a3a3]">
                {p.github && <span>GitHub</span>}
                {p.live && <span>Live</span>}
              </div>
            </div>
            <p className="mt-1 text-[10px] text-[#a3a3a3] line-clamp-2">{p.summary}</p>

            {p.technologies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.technologies.slice(0, 5).map(t => (
                  <span key={t} className="size-6 rounded-md border border-[rgba(255,255,255,0.1)] bg-[#262626] flex items-center justify-center text-[8px] text-[#a3a3a3]">
                    {t.slice(0, 2)}
                  </span>
                ))}
                {p.technologies.length > 5 && (
                  <span className="text-[8px] text-[#737373] self-center">+{p.technologies.length - 5}</span>
                )}
              </div>
            )}

            {p.bullets.length > 0 && (
              <ul className="mt-2 space-y-1">
                {p.bullets.slice(0, 1).map((b, j) => {
                  const { highlight, detail } = parseBullet(b);
                  return (
                    <li key={j} className="flex gap-2 text-[10px]">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[rgba(255,255,255,0.3)]" />
                      <span className="text-[#a3a3a3] line-clamp-1">
                        <span className="text-[#fafafa] font-medium">{highlight}</span>{" "}
                        {detail}
                      </span>
                    </li>
                  );
                })}
                {p.bullets.length > 1 && (
                  <li className="text-[8px] text-[#737373] ml-3">+{p.bullets.length - 1} more bullets</li>
                )}
              </ul>
            )}
          </div>
        ))}
        {projects.length > 3 && (
          <p className="text-[10px] text-[#737373]">+{projects.length - 3} more projects</p>
        )}
        {projects.length === 0 && <p className="text-[10px] text-[#737373] italic">No projects yet</p>}
      </div>
    </div>
  );
}

// ─── Blogs Preview ───────────────────────────────────────────────

interface BlogData {
  title: string;
  description: string;
  image?: string;
  imageOrientation?: string;
}

export function BlogsPreview({ blogs }: { blogs: BlogData[] }) {
  return (
    <div>
      <SectionLabel sub="Writing" main="Blogs" />
      <div className="grid grid-cols-2 gap-2">
        {blogs.slice(0, 4).map((b, i) => (
          <div key={i} className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] overflow-hidden">
            {b.image && (
              <div className="h-16 overflow-hidden bg-[#262626]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.image} alt={b.title} className="w-full h-full object-cover opacity-80" />
              </div>
            )}
            <div className="p-2">
              <p className="text-[10px] font-semibold text-[#fafafa] line-clamp-1">{b.title}</p>
              <p className="text-[8px] text-[#a3a3a3] line-clamp-2 mt-0.5">{b.description}</p>
            </div>
          </div>
        ))}
      </div>
      {blogs.length > 4 && (
        <p className="text-[10px] text-[#737373] mt-2">+{blogs.length - 4} more blogs</p>
      )}
      {blogs.length === 0 && <p className="text-[10px] text-[#737373] italic">No blogs yet</p>}
    </div>
  );
}

// ─── Quotes Preview ──────────────────────────────────────────────

export function QuotesPreview({ quotes }: { quotes: { quote: string; author: string }[] }) {
  const today = new Date();
  const dayIndex = (today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate());
  const thought = quotes.length > 0 ? quotes[dayIndex % quotes.length]! : null;

  return (
    <div>
      <div className="relative rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#171717] p-4 text-center">
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#0a0a0a] px-2 text-[8px] font-medium text-[#a3a3a3] uppercase tracking-wider">
          Thought of the Day
        </span>
        {thought ? (
          <>
            <blockquote className="text-xs font-medium italic text-[#fafafa]/90 leading-relaxed">
              &ldquo;{thought.quote}&rdquo;
            </blockquote>
            <p className="mt-2 text-[10px] text-[#a3a3a3]">&mdash; {thought.author}</p>
          </>
        ) : (
          <p className="text-[10px] text-[#737373] italic">No quotes yet</p>
        )}
      </div>
      {quotes.length > 1 && (
        <p className="text-[10px] text-[#737373] mt-2 text-center">
          {quotes.length} quotes total &middot; Rotates daily
        </p>
      )}
    </div>
  );
}

// ─── Contact Preview ─────────────────────────────────────────────

interface ContactPreviewProps {
  purposes: { label: string; emoji: string }[];
  availabilityStatus?: string;
  availabilityDetail?: string;
  socialLinks?: { name: string }[];
}

export function ContactPreview({ purposes, availabilityStatus, availabilityDetail, socialLinks }: ContactPreviewProps) {
  return (
    <div>
      <SectionLabel sub="Let's Connect" main="Get in Touch" />
      <div className="grid grid-cols-5 gap-3">
        {/* Form side */}
        <div className="col-span-3 space-y-3">
          <div>
            <span className="text-[8px] font-medium text-[#a3a3a3] uppercase tracking-wider">What&apos;s this about?</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {purposes.map((p, i) => (
                <span
                  key={p.label}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[8px] font-medium",
                    i === 0
                      ? "border-[#fafafa] bg-[#fafafa] text-[#0a0a0a]"
                      : "border-[rgba(255,255,255,0.1)] text-[#a3a3a3]"
                  )}
                >
                  {p.emoji} {p.label}
                </span>
              ))}
              {purposes.length === 0 && <span className="text-[8px] text-[#737373] italic">No purposes yet</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#171717] px-2 py-1.5 text-[8px] text-[#737373]">Your name</div>
            <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#171717] px-2 py-1.5 text-[8px] text-[#737373]">you@example.com</div>
          </div>
          <div className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[#171717] px-2 py-3 text-[8px] text-[#737373]">
            Tell me about your project...
          </div>
          <div className="flex justify-end">
            <span className="rounded-md bg-[#fafafa] px-3 py-1 text-[8px] font-medium text-[#0a0a0a]">Send Message</span>
          </div>
        </div>

        {/* Info side */}
        <div className="col-span-2 space-y-2">
          {availabilityStatus && (
            <div className="flex items-center gap-2 p-2">
              <span className="size-2 rounded-full bg-[#22c55e]" />
              <div>
                <p className="text-[10px] font-medium text-[#fafafa]">{availabilityStatus}</p>
                {availabilityDetail && <p className="text-[8px] text-[#a3a3a3]">{availabilityDetail}</p>}
              </div>
            </div>
          )}
          {socialLinks && socialLinks.map(l => (
            <div key={l.name} className="flex items-center gap-2 p-2 text-[10px] text-[#a3a3a3]">
              {l.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Links Preview ──────────────────────────────────────────────

interface LinksPreviewProps {
  socialLinks: { name: string; href: string; iconKey: string; detail: string | null }[];
  resumeUrl?: string;
  contactEmail?: string;
}

export function LinksPreview({ socialLinks, resumeUrl, contactEmail }: LinksPreviewProps) {
  return (
    <div className="space-y-6">
      {/* Hero Section Links */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[8px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>Hero</span>
          <span className="text-[10px] text-[#737373]">How links appear in your hero section</span>
        </div>
        <div className="flex gap-2.5 mb-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
            style={{ border: '1px solid rgba(255,255,255,0.15)', background: '#0a0a0a', color: '#fafafa' }}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            Resume / CV
            {resumeUrl && <span className="text-[8px] text-[#22c55e]">&#10003;</span>}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
            style={{ background: '#fafafa', color: '#0a0a0a' }}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            Get in touch
          </span>
        </div>
        <div className="flex gap-4">
          {socialLinks.map((l) => (
            <span key={l.name} className="text-xs font-medium" style={{ color: '#a3a3a3' }}>{l.name}</span>
          ))}
        </div>
        {resumeUrl && (
          <p className="text-[8px] mt-2 truncate max-w-full" style={{ color: '#737373' }}>
            Resume → {resumeUrl}
          </p>
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />

      {/* Contact Section Links */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[8px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.15)', color: '#fb7185' }}>Contact</span>
          <span className="text-[10px] text-[#737373]">Social links in contact sidebar</span>
        </div>
        <div className="space-y-1.5">
          {socialLinks.map((l) => (
            <div
              key={l.name}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ border: '1px solid rgba(255,255,255,0.08)', background: '#171717' }}
            >
              <span className="size-5 rounded bg-[#262626] flex items-center justify-center text-[8px] text-[#a3a3a3] font-bold">
                {l.name.slice(0, 2)}
              </span>
              <div>
                <p className="text-[10px] font-medium text-[#fafafa]">{l.name}</p>
                {l.detail && <p className="text-[8px] text-[#a3a3a3]">{l.detail}</p>}
                <p className="text-[8px] truncate max-w-[300px]" style={{ color: '#525252' }}>{l.href}</p>
              </div>
            </div>
          ))}
          {socialLinks.length === 0 && <p className="text-[10px] text-[#737373] italic">No social links yet</p>}
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />

      {/* Footer Links */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[8px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>Footer</span>
          <span className="text-[10px] text-[#737373]">Links in the page footer</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-lg px-3 py-3" style={{ border: '1px solid rgba(255,255,255,0.08)', background: '#171717' }}>
          {socialLinks.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
              <span className="size-3 rounded bg-[#262626] flex items-center justify-center text-[6px] font-bold">{l.name.slice(0, 1)}</span>
              {l.iconKey === 'email' ? (l.detail || contactEmail || l.name) : l.name}
            </span>
          ))}
          {socialLinks.length === 0 && <span className="text-[10px] text-[#737373] italic">No links</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Helper ──────────────────────────────────────────────────────

function parseBullet(content: string) {
  const match = content.match(/^\*\*(.*?)\*\*\s?(.*)/s);
  if (match) return { highlight: match[1]!, detail: match[2]! };
  return { highlight: content, detail: "" };
}
