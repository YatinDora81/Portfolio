"use client";

import { ExternalLinkIcon, GithubIcon } from "@repo/ui/icons/brand";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { cdnUrl } from "@/lib/utils";
import { DIM, MONO, SectionLabel, parseBullet } from "./frame";

// ─── Projects Preview ────────────────────────────────────────────
// Mirrors apps/web/app/components/landing/Projects.tsx, which ships in two
// interchangeable layouts picked by the layout card on this page. Both are drawn
// here, and the pane switches on the same `projectsVersion` value the site reads.
//
//   v1 "the work ledger" — no card and no hover fill, ever. Structure comes
//      from permanent hairline dividers and a mono index; the feedback lives
//      inside the content: the 2px active-line bar in the gutter, the image
//      zoom, the title's underline sweep, and the siblings dimming away.
//      Its signature detail is the stack set as ONE mono line of `·`-joined
//      names rather than a pile of pills.
//
//   v2 "the build log" — every project is a deployment record: the keyline
//      header (number — domain ——— ● live), then the screenshot on a dot-grid
//      pad wearing a `▲ prod` tab, and the title / summary / badges / links
//      beside it. Closes on the section's sign-off line.
//
// Both fold their highlights open on hover only, the way the site does it in
// CSS, and both are drawn at rest otherwise: the "more builds" fold is closed
// and its button sits unpressed. What the pane deliberately drops is the
// section's entrances — v2's typed-out domain and its blur-up IntersectionObserver
// reveal, plus the signal sweeping the keyline rule — because these panes have
// never animated an arrival.

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

const LINE = "rgba(255,255,255,0.1)";

/** `--lab-dim` on the site's dark theme — the keyline voice the build log's
 *  record header is set in, a step quieter than the section's secondary ink. */
const LAB_DIM = "#8b8b8d";

/** `--ok` on dark: the deployed signal, and the only green in the section. */
const OK = "#4ade80";

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

/** The site's `.pj-dot` — a live signal with its ping. */
function LiveDot() {
  return (
    <span className="relative size-[5px] shrink-0 rounded-full" style={{ background: OK }} aria-hidden>
      <span className="absolute -inset-[2px] rounded-full border animate-ping motion-reduce:animate-none" style={{ borderColor: OK }} />
    </span>
  );
}

/** The hovered row's fold, holding the highlights at 0fr until then — the same
 *  trick the site uses, so a resting row shows nothing but the summary. */
function Highlights({ bullets, marker }: { bullets: string[]; marker: string }) {
  const parsed = bullets.slice(0, PREVIEW_BULLETS).map(parseBullet);
  if (parsed.length === 0) return null;

  return (
    <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-500 group-hover:grid-rows-[1fr] motion-reduce:transition-none">
      <div className="min-h-0 overflow-hidden opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none">
        <ul className="mt-2 flex flex-col gap-[7px] text-[10px] leading-[1.6]">
          {parsed.map((bullet, i) => (
            <li key={i} className="grid grid-cols-[10px_1fr] gap-[6px] text-[#909092]">
              <i className="not-italic text-[9px] leading-[1.75] text-[rgba(144,144,146,0.7)]" style={{ fontFamily: MONO }} aria-hidden>{marker}</i>
              <span>
                <b className="font-medium text-[#fafafa]">{bullet.highlight}</b> {bullet.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── v1 — the work ledger ────────────────────────────────────────

function LedgerRow({ project, index }: { project: ProjectData; index: number }) {
  const thumb = project.images?.[0];
  const linked = Boolean(project.live ?? project.github);
  const chips = project.technologies.slice(0, PREVIEW_CHIPS);
  const moreChips = project.technologies.length - chips.length;

  return (
    <article
      data-pj-row
      className="group relative grid grid-cols-[20px_120px_minmax(0,1fr)] items-start gap-3 border-t border-[rgba(255,255,255,0.1)] py-3 pl-2 pr-0.5 transition-opacity duration-300 motion-reduce:transition-none"
    >
      {/* the editor's active-line bar — this version's identity, and the only
          thing that marks the row, since it never gets a box or a fill */}
      <span className="pointer-events-none absolute inset-y-3 left-0 w-[2px] origin-top scale-y-0 bg-[#fafafa] transition-transform duration-500 group-hover:scale-y-100 motion-reduce:transition-none" aria-hidden />

      <span className="pt-[3px] text-[9px] tracking-[0.05em] text-[#909092] transition-colors group-hover:text-[#fafafa] motion-reduce:transition-none" style={{ fontFamily: MONO }} aria-hidden>
        {String(index + 1).padStart(2, "0")}
      </span>

      <span className="relative block overflow-hidden rounded-[6px] bg-[#262626]" style={{ aspectRatio: "16 / 10" }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cdnUrl(thumb)}
            alt=""
            aria-hidden
            className="size-full object-cover object-top saturate-[.9] brightness-[.96] transition-[transform,filter] duration-500 group-hover:scale-[1.045] group-hover:saturate-100 group-hover:brightness-100 motion-reduce:transition-none"
          />
        )}
        {/* the ring rides above the image so the zoom clips under a fixed hairline */}
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] border border-[rgba(255,255,255,0.1)] transition-colors group-hover:border-[rgba(250,250,250,0.26)] motion-reduce:transition-none" aria-hidden />
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {project.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cdnUrl(project.logoUrl)} alt="" aria-hidden className="h-[15px] w-auto max-w-[32px] shrink-0 rounded object-contain" />
          )}
          <span className="relative inline-flex min-w-0 items-center gap-1.5 text-[13px] font-bold tracking-[-0.02em] text-[#fafafa]">
            <span className="truncate">{project.title}</span>
            {linked && <ArrowUpRight />}
            <span className="pointer-events-none absolute bottom-[-3px] left-0 right-[18px] h-px origin-left scale-x-0 bg-current transition-transform duration-500 group-hover:scale-x-100 motion-reduce:transition-none" aria-hidden />
          </span>
          <span className="ml-auto shrink-0 text-[8px] uppercase tracking-[0.18em] text-[#909092] opacity-0 transition-opacity group-hover:opacity-90 motion-reduce:transition-none" style={{ fontFamily: MONO }} aria-hidden>
            highlights ▸
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.65] text-[#909092]">{project.summary}</p>

        <Highlights bullets={project.bullets} marker="+" />

        {/* the stack as one quiet line, not a pile of pills — the ledger's tell */}
        {chips.length > 0 && (
          <p className="mt-2 text-[9px] leading-[1.9] tracking-[0.03em] text-[#909092]" style={{ fontFamily: MONO }}>
            {chips.map((tech, i) => (
              <span key={tech}>
                {i > 0 && <span className="mx-[2px] opacity-[0.55]">·</span>}
                {tech}
              </span>
            ))}
            {moreChips > 0 && <span className="text-[#737373]"> +{moreChips}</span>}
          </p>
        )}

        {(project.live || project.github) && (
          <div className="mt-2 flex gap-4 text-[9px] tracking-[0.02em] text-[#909092]" style={{ fontFamily: MONO }}>
            {project.live && (
              <span className="inline-flex items-center gap-1.5">
                <LiveDot />live demo
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

function ProjectsPreviewLedger({ projects }: { projects: ProjectData[] }) {
  return (
    // spotlight by subtraction: hovering one row pushes every other one back
    <div className="flex flex-col border-b border-[rgba(255,255,255,0.1)] [&:has([data-pj-row]:hover)_[data-pj-row]:not(:hover)]:opacity-[0.38]">
      {projects.map((project, i) => (
        <LedgerRow key={`${project.title}-${i}`} project={project} index={i} />
      ))}
    </div>
  );
}

// ─── v2 — the build log ──────────────────────────────────────────

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    // Parsing is not enough: `new URL("localhost:3000")` throws nothing and comes
    // back as the scheme `localhost:` with no host. The site's `endpointOf` makes
    // the same check, and the two derivations have to agree or the pane reports a
    // deployment the section does not.
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && url.hostname ? url : null;
  } catch {
    // a hand-typed URL in the CMS must not take the whole pane down
    return null;
  }
}

/**
 * Where the build runs, derived rather than stored: the live host wins and
 * carries the signal dot, a repo falls back to its path and is only `source`,
 * and a project with neither address gets no header beyond its number.
 */
function deployment(project: ProjectData) {
  const host = safeUrl(project.live)?.hostname.replace(/^www\./, "");
  if (host) return { domain: host, status: "live", running: true };
  // Trailing slash trimmed, exactly as `endpointOf` trims it — a repo URL saved
  // with one would otherwise print a domain the site never shows.
  const path = safeUrl(project.github)?.pathname.replace(/\/$/, "");
  if (path) return { domain: `github.com${path}`, status: "source", running: false };
  return null;
}

function LogEntry({ project, index }: { project: ProjectData; index: number }) {
  const thumb = project.images?.[0];
  const linked = Boolean(project.live ?? project.github);
  const chips = project.technologies.slice(0, PREVIEW_CHIPS);
  const moreChips = project.technologies.length - chips.length;
  const record = deployment(project);

  return (
    <article className="group pb-4 pt-2.5">
      {/* keyline record header, borrowed from the contact section's frequency rows */}
      <div className="flex min-w-0 items-center gap-2.5 text-[9px] tracking-[0.16em]" style={{ fontFamily: MONO, color: LAB_DIM }}>
        <span className="shrink-0 transition-colors group-hover:text-[#fafafa] motion-reduce:transition-none">
          {String(index + 1).padStart(2, "0")}
        </span>
        {record && (
          <span className="max-w-[52%] truncate transition-colors group-hover:text-[#fafafa] motion-reduce:transition-none">
            {record.domain}
          </span>
        )}
        <i className="h-px min-w-[16px] flex-1" style={{ background: LINE }} aria-hidden />
        {record && (
          <span className="inline-flex shrink-0 items-center gap-1.5" style={record.running ? { color: OK } : undefined}>
            {record.running && <LiveDot />}
            {record.status}
          </span>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-[140px_minmax(0,1fr)] items-start gap-3">
        <div
          className="relative rounded-[8px] border border-[rgba(255,255,255,0.1)] p-1.5 transition-[border-color,transform] group-hover:-translate-y-[2px] group-hover:border-[rgba(250,250,250,0.26)] motion-reduce:transition-none"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "8px 8px" }}
        >
          {/* the tab sits ON the pad's border, so it needs the pane's own ground.
              Shown only where there is a production to have shot, matching the
              section's own condition. */}
          {record?.running && (
            <span
              className="absolute -top-[6px] right-2 flex items-center gap-1 bg-[#0a0a0a] px-1 text-[8px] tracking-[0.16em] text-[#909092] transition-colors group-hover:text-[#fafafa] motion-reduce:transition-none"
              style={{ fontFamily: MONO }}
              aria-hidden
            >
              ▲ prod
            </span>
          )}
          <span className="block overflow-hidden rounded-[5px] bg-[#262626]" style={{ aspectRatio: "16 / 10" }}>
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cdnUrl(thumb)} alt="" aria-hidden className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
            )}
          </span>
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {project.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cdnUrl(project.logoUrl)} alt="" aria-hidden className="h-[15px] w-auto max-w-[32px] shrink-0 rounded object-contain" />
            )}
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-bold tracking-[-0.01em] text-[#fafafa]">
              <span className="truncate">{project.title}</span>
              {linked && <ArrowUpRight />}
            </span>
            <span className="ml-auto shrink-0 text-[8px] uppercase tracking-[0.18em] text-[#909092] opacity-0 transition-opacity group-hover:opacity-90 motion-reduce:transition-none" style={{ fontFamily: MONO }} aria-hidden>
              highlights
            </span>
          </div>

          <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.65] text-[#909092]">{project.summary}</p>

          <Highlights bullets={project.bullets} marker="▸" />

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
      </div>
    </article>
  );
}

function ProjectsPreviewBuildLog({ projects }: { projects: ProjectData[] }) {
  return (
    <div>
      {projects.map((project, i) => (
        <LogEntry key={`${project.title}-${i}`} project={project} index={i} />
      ))}
    </div>
  );
}

/**
 * The line the site sets under the section heading — the first thing a visitor
 * reads, so the pane would misreport the section without it. Counted off the
 * WHOLE list for the same reason `EndOfLog` is: the fold hides rows, not facts,
 * and v2 only claims everything is deployed when everything actually is.
 */
function PaneNote({ version, projects }: { version: "v1" | "v2"; projects: ProjectData[] }) {
  const note =
    version === "v1"
      ? `${projects.length} ${projects.length === 1 ? "thing" : "things"} shipped end to end — hover a row to spotlight it, tap or click for the highlights.`
      : `${projects.every((p) => deployment(p)?.running) ? "every build below is deployed & running — " : ""}tap or hover a build for the highlights`;

  return (
    <p className="-mt-2 mb-3 text-[9.5px] leading-[1.6]" style={{ color: DIM }}>
      {version === "v2" && (
        <span className="mr-1" style={{ fontFamily: MONO }} aria-hidden="true">⌖</span>
      )}
      {note}
    </p>
  );
}

/** The build log's sign-off. Counts the WHOLE list, not the featured cut — the
 *  site's line reports the log, and the fold is only hiding part of it. */
function EndOfLog({ projects }: { projects: ProjectData[] }) {
  const running = projects.filter((project) => deployment(project)?.running).length;
  return (
    <div className="mt-5 flex items-center gap-3 text-[8.5px] tracking-[0.2em]" style={{ fontFamily: MONO, color: LAB_DIM }}>
      <span className="h-px flex-1" style={{ background: LINE }} aria-hidden />
      end of build log · {running}/{projects.length} live
      <span className="h-px flex-1" style={{ background: LINE }} aria-hidden />
    </div>
  );
}

// ─── Dispatch ────────────────────────────────────────────────────

export function ProjectsPreview({ version, projects }: { version: "v1" | "v2"; projects: ProjectData[] }) {
  const featured = projects.slice(0, FEATURED);
  const rest = projects.length - featured.length;

  return (
    <div>
      <SectionLabel sub="Work" main="Projects" />

      {projects.length > 0 && <PaneNote version={version} projects={projects} />}

      {projects.length === 0 ? (
        <p className="text-[10px] italic text-[#737373]">No projects yet</p>
      ) : version === "v1" ? (
        <ProjectsPreviewLedger projects={featured} />
      ) : (
        <ProjectsPreviewBuildLog projects={featured} />
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

      {version === "v2" && projects.length > 0 && <EndOfLog projects={projects} />}
    </div>
  );
}
