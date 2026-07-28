"use client";

import { ExternalLinkIcon, GithubIcon } from "@repo/ui/icons/brand";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { cdnUrl } from "@/lib/utils";
import { MONO, SectionLabel, parseBullet } from "./frame";

// ─── Projects Preview ────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/Projects.tsx — compact rows rather
// than cards: a 16/10 cover, the title with its arrow, the summary, then the
// highlights that stay folded until the row is hovered (the site does that in
// CSS, so the preview does too), the stack chips and the mono `live demo` /
// `source` pair. Three rows are featured and the rest sit behind the site's
// "Show More Projects" button, drawn here in its resting state.

interface ProjectData {
  title: string;
  summary: string;
  bullets: string[];
  technologies: string[];
  github?: string | null;
  live?: string | null;
  /** OPTIONAL — the site draws `images[0]` as the row's cover. */
  images?: string[];
  /** OPTIONAL — the small mark the site puts before the title. */
  logoUrl?: string | null;
}

/** Same cut as the site: three rows lead, the rest are behind the button. */
const FEATURED = 3;

/** The fold is only open on hover, so this just bounds the reveal. */
const PREVIEW_BULLETS = 4;

const PREVIEW_CHIPS = 6;

function ArrowUpRight() {
  return (
    <svg className="size-3 shrink-0 text-[#909092] transition-[transform,color] group-hover:translate-x-[2px] group-hover:-translate-y-[2px] group-hover:text-[#fafafa] motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

/** The site's `.badge` — pill, muted fill, inner shadow, glyph from the registry. */
function TechBadge({ name }: { name: string }) {
  const icon = findSkillIcon(name);
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full border border-[rgba(255,255,255,0.1)] bg-[#262626] px-2 py-[2px] text-[9px] text-[#fafafa]"
      style={{ boxShadow: "inset 0 1px 2px rgba(255,255,255,0.06), inset 0 1px 4px rgba(255,255,255,0.03)" }}
    >
      {icon && (
        <span className="inline-flex size-[10px] shrink-0 [&>svg]:block [&>svg]:size-full">
          <icon.Icon />
        </span>
      )}
      {name}
    </span>
  );
}

function ProjectRow({ project }: { project: ProjectData }) {
  const thumb = project.images?.[0];
  const linked = Boolean(project.live ?? project.github);
  const bullets = project.bullets.slice(0, PREVIEW_BULLETS).map(parseBullet);
  const chips = project.technologies.slice(0, PREVIEW_CHIPS);
  const moreChips = project.technologies.length - chips.length;

  return (
    <article className="group relative -mx-2 flex flex-wrap items-start gap-3 rounded-xl border border-transparent p-2.5 transition-colors hover:border-[rgba(255,255,255,0.1)] hover:bg-[#171717] motion-reduce:transition-none">
      {/* the hover affordance, resting at opacity 0 exactly like the site's */}
      <span
        className="pointer-events-none absolute right-2.5 top-2.5 text-[8px] uppercase tracking-[0.18em] text-[#909092] opacity-0 transition-opacity group-hover:opacity-90 motion-reduce:transition-none"
        style={{ fontFamily: MONO }}
        aria-hidden="true"
      >
        highlights
      </span>

      <span className="block w-[120px] shrink-0 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#262626] transition-[transform,border-color] group-hover:-translate-y-[2px] group-hover:border-[rgba(250,250,250,0.28)] motion-reduce:transition-none" style={{ aspectRatio: "16 / 10" }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cdnUrl(thumb)} alt="" aria-hidden className="size-full object-cover object-top" />
        )}
      </span>

      <div className="min-w-[168px] flex-1">
        <div className="flex flex-wrap items-center gap-2 pr-14">
          {project.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cdnUrl(project.logoUrl)} alt="" aria-hidden className="h-[15px] w-auto max-w-[32px] shrink-0 rounded object-contain" />
          )}
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold tracking-[-0.01em] text-[#fafafa]">
            {project.title}
            {linked && <ArrowUpRight />}
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.65] text-[#909092]">{project.summary}</p>

        {/* the site keeps the highlights in the DOM and animates 0fr→1fr on
            hover / focus-within — same trick here, so the row rests closed */}
        {bullets.length > 0 && (
          <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-500 group-hover:grid-rows-[1fr] motion-reduce:transition-none">
            <div className="min-h-0 overflow-hidden opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none">
              <ul className="mt-2 flex flex-col gap-[7px] text-[10px] leading-[1.6]">
                {bullets.map((bullet, i) => (
                  <li key={i} className="flex gap-2">
                    <i className="mt-[6px] size-[4px] shrink-0 rounded-full bg-[rgba(250,250,250,0.4)]" />
                    <span className="text-[#909092]">
                      <b className="font-medium text-[#fafafa]">{bullet.highlight}</b> {bullet.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-[5px]">
            {chips.map((tech) => <TechBadge key={tech} name={tech} />)}
            {moreChips > 0 && (
              <span className="text-[9px] text-[#737373]" style={{ fontFamily: MONO }}>+{moreChips}</span>
            )}
          </div>
        )}

        {(project.live || project.github) && (
          <div className="mt-2 flex gap-4 text-[9px] tracking-[0.02em] text-[#909092]" style={{ fontFamily: MONO }}>
            {project.live && (
              <span className="inline-flex items-center gap-1.5">
                <ExternalLinkIcon className="size-[11px]" />live demo
              </span>
            )}
            {project.github && (
              <span className="inline-flex items-center gap-1.5">
                <GithubIcon className="size-[11px]" />source
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function ProjectsPreview({ projects }: { projects: ProjectData[] }) {
  const featured = projects.slice(0, FEATURED);
  const rest = projects.length - featured.length;

  return (
    <div>
      <SectionLabel sub="Work" main="Projects" />

      {projects.length === 0 ? (
        <p className="text-[10px] italic text-[#737373]">No projects yet</p>
      ) : (
        <div className="flex flex-col">
          {featured.map((project, i) => (
            <ProjectRow key={`${project.title}-${i}`} project={project} />
          ))}
        </div>
      )}

      {rest > 0 && (
        <div className="mt-4 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.1)] px-4 py-2 text-[11px] font-medium text-[#909092]">
            Show More Projects
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}
