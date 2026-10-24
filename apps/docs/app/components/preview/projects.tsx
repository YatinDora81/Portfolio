"use client";

import { ExternalLinkIcon, GithubIcon } from "@repo/ui/icons/brand";
import { findSkillIcon } from "@repo/ui/icons/registry";
import { cdnUrl } from "@/lib/utils";
import { DIM, MONO, SectionLabel, parseBullet } from "./frame";

type BuildState = "SHIPPED" | "BUILDING" | "PAUSED";

type MilestoneState = "DONE" | "DOING" | "NEXT";

interface Milestone {
  label: string;
  state: MilestoneState;
}

interface ProjectData {
  title: string;
  summary: string;
  bullets: string[];
  technologies: string[];
  github?: string | null;
  live?: string | null;
  images?: string[];
  logoUrl?: string | null;
  buildState?: BuildState;
  buildVersion?: string | null;
  etaLabel?: string | null;
  milestones?: Milestone[];
}

const FEATURED = 3;

const PREVIEW_BULLETS = 4;

const PREVIEW_CHIPS = 6;

const LINE = "rgba(255,255,255,0.1)";

const LAB_DIM = "#8b8b8d";

const OK = "#4ade80";

const PANES = 3;

const WIP = "#f59e0b";

const WIP_INK = "#fbbf24";

const WIP_SOFT = "rgba(245,158,11,0.12)";

const HAIR = "rgba(250,250,250,0.27)";

const HAIR_SOFT = "rgba(250,250,250,0.16)";

const FILL = "rgba(250,250,250,0.19)";

const SOLID = "rgba(250,250,250,0.28)";

const shipped = (project: ProjectData) => (project.buildState ?? "SHIPPED") === "SHIPPED";

function wipInk(project: ProjectData) {
  return project.buildState === "PAUSED" ? LAB_DIM : WIP_INK;
}

function paneStyle(state: MilestoneState, drained: boolean) {
  if (state === "DONE") return { border: `1px solid ${SOLID}`, background: FILL };
  if (state === "DOING") {
    return drained
      ? { border: `1px solid ${HAIR}`, background: "transparent" }
      : { border: `1px solid ${WIP}`, background: WIP_SOFT };
  }
  return { border: `1px dashed ${HAIR}`, background: "transparent" };
}

function MiniBlueprint({ project }: { project: ProjectData }) {
  const milestones = project.milestones ?? [];
  const panes = Array.from({ length: PANES }, (_, i) => milestones[i]);
  const doing = milestones.filter((m) => m.state === "DOING");
  const drained = project.buildState === "PAUSED";
  const ink = wipInk(project);

  const pane = (milestone: Milestone | undefined, grow: number) => (
    <span
      className="flex min-w-0 flex-col gap-[3px] overflow-hidden rounded-[2px] px-[4px] py-[3px]"
      style={{ flex: `${grow} 1 0`, ...paneStyle(milestone?.state ?? "NEXT", drained) }}
    >
      {milestone && (
        <span
          className="truncate text-[6.5px] tracking-[0.1em]"
          style={{
            fontFamily: MONO,
            color: milestone.state === "DOING" && !drained ? ink : LAB_DIM,
          }}
        >
          {milestone.label}
        </span>
      )}
    </span>
  );

  return (
    <span
      className="flex flex-col gap-[4px] p-[5px]"
      style={{ aspectRatio: "16 / 10" }}
      role="img"
      aria-label={`Working drawing of ${project.title}`}
    >
      <span className="flex min-h-0 flex-1 gap-[4px]">
        <span
          className="flex w-[13%] flex-none flex-col gap-[3px] rounded-[2px] p-[3px]"
          style={{ border: `1px solid ${HAIR}` }}
        >
          <i className="h-[4px] w-full rounded-[1px]" style={{ background: HAIR }} />
          <i className="h-[1.5px] w-[84%] rounded-[1px]" style={{ background: HAIR }} />
          <i className="h-[1.5px] w-[62%] rounded-[1px]" style={{ background: HAIR }} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span
            className="flex h-[13%] flex-none items-center gap-[4px] rounded-[2px] px-[4px]"
            style={{ border: `1px solid ${HAIR}` }}
          >
            <i className="h-[1.5px] w-[24%] rounded-[1px]" style={{ background: HAIR }} />
            <i className="h-[1.5px] w-[13%] rounded-[1px]" style={{ background: HAIR }} />
          </span>
          <span className="flex min-h-0 flex-1 gap-[4px]">
            {pane(panes[0], 155)}
            <span className="flex min-w-0 flex-col gap-[4px]" style={{ flex: "100 1 0" }}>
              {pane(panes[1], 1)}
              {pane(panes[2], 1)}
            </span>
          </span>
        </span>
      </span>
      <span className="flex flex-none items-center gap-[5px]">
        <i className="h-[5px] w-px flex-none" style={{ background: HAIR_SOFT }} />
        <i className="h-px flex-1" style={{ background: HAIR_SOFT }} />
        {doing.length === 1 && (
          <>
            <span
              className="flex-none text-[6.5px] tracking-[0.12em]"
              style={{ fontFamily: MONO, color: LAB_DIM }}
            >
              stage · <b className="font-medium" style={{ color: ink }}>{doing[0]!.label}</b>
            </span>
            <i className="h-px flex-1" style={{ background: HAIR_SOFT }} />
          </>
        )}
        <i className="h-[5px] w-px flex-none" style={{ background: HAIR_SOFT }} />
      </span>
    </span>
  );
}

function EtaMarker({ project }: { project: ProjectData }) {
  const eta = project.buildState === "BUILDING" ? project.etaLabel : null;
  if (project.live) {
    if (!eta) return null;
    return (
      <span className="inline-flex items-center gap-1" style={{ color: LAB_DIM }}>
        <b className="font-normal" style={{ color: wipInk(project) }}>{eta}</b>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" style={{ color: LAB_DIM }}>
      no demo yet
      {eta && (
        <>
          ·<b className="font-normal" style={{ color: wipInk(project) }}>{eta}</b>
        </>
      )}
    </span>
  );
}

function ArrowUpRight() {
  return (
    <svg className="size-3 shrink-0 text-[#909092] transition-[transform,color] group-hover:translate-x-[2px] group-hover:-translate-y-[2px] group-hover:text-[#fafafa] motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

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

function LiveDot() {
  return (
    <span className="relative size-[5px] shrink-0 rounded-full" style={{ background: OK }} aria-hidden>
      <span className="absolute -inset-[2px] rounded-full border animate-ping motion-reduce:animate-none" style={{ borderColor: OK }} />
    </span>
  );
}

function WipDot({ project }: { project: ProjectData }) {
  const paused = project.buildState === "PAUSED";
  const tone = paused ? LAB_DIM : WIP;
  return (
    <span className="relative size-[5px] shrink-0 rounded-full" style={{ background: tone }} aria-hidden>
      {!paused && (
        <span className="absolute -inset-[2px] rounded-full border animate-ping motion-reduce:animate-none" style={{ borderColor: tone }} />
      )}
    </span>
  );
}

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

function LedgerRow({ project, index }: { project: ProjectData; index: number }) {
  const thumb = project.images?.[0];
  const built = shipped(project);
  const drawn = !built && !thumb;
  const linked = built ? Boolean(project.live ?? project.github) : Boolean(project.github);
  const chips = project.technologies.slice(0, PREVIEW_CHIPS);
  const moreChips = project.technologies.length - chips.length;

  return (
    <article
      data-pj-row
      className="group relative grid grid-cols-[20px_120px_minmax(0,1fr)] items-start gap-3 border-t border-[rgba(255,255,255,0.1)] py-3 pl-2 pr-0.5 transition-opacity duration-300 motion-reduce:transition-none"
    >

      <span className="pointer-events-none absolute inset-y-3 left-0 w-[2px] origin-top scale-y-0 bg-[#fafafa] transition-transform duration-500 group-hover:scale-y-100 motion-reduce:transition-none" aria-hidden />

      <span className="pt-[3px] text-[9px] tracking-[0.05em] text-[#909092] transition-colors group-hover:text-[#fafafa] motion-reduce:transition-none" style={{ fontFamily: MONO }} aria-hidden>
        {String(index + 1).padStart(2, "0")}
        {!built && (
          <span className="mt-[3px] block text-[7px] tracking-[0.14em]" style={{ color: wipInk(project) }}>
            {project.buildState === "PAUSED" ? "paused" : "wip"}
          </span>
        )}
      </span>

      {drawn ? (
        <span
          className="relative block overflow-hidden rounded-[6px]"
          style={{
            aspectRatio: "16 / 10",
            backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "8px 8px",
          }}
        >
          <span
            className="absolute right-1 top-[2px] z-[1] text-[7px] tracking-[0.14em]"
            style={{ fontFamily: MONO, color: wipInk(project) }}
            aria-hidden
          >
            ▲{drawn ? " plan" : ""}{project.buildVersion ? `${drawn ? " · " : " "}${project.buildVersion}` : ""}
          </span>
          <MiniBlueprint project={project} />
          <span
            className="pointer-events-none absolute inset-0 rounded-[inherit] border"
            style={{ borderColor: project.buildState === "PAUSED" ? LINE : "rgba(245,158,11,0.34)" }}
            aria-hidden
          />
        </span>
      ) : (
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

          <span className="pointer-events-none absolute inset-0 rounded-[inherit] border border-[rgba(255,255,255,0.1)] transition-colors group-hover:border-[rgba(250,250,250,0.26)] motion-reduce:transition-none" aria-hidden />
        </span>
      )}

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

        {(project.live || project.github || !built) && (
          <div className="mt-2 flex gap-4 text-[9px] tracking-[0.02em] text-[#909092]" style={{ fontFamily: MONO }}>
            {!built && <EtaMarker project={project} />}
            {project.live && (
              <span className="inline-flex items-center gap-1.5">
                {built ? <LiveDot /> : <WipDot project={project} />}live demo
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
    <div className="flex flex-col border-b border-[rgba(255,255,255,0.1)] [&:has([data-pj-row]:hover)_[data-pj-row]:not(:hover)]:opacity-[0.38]">
      {projects.map((project, i) => (
        <LedgerRow key={`${project.title}-${i}`} project={project} index={i} />
      ))}
    </div>
  );
}

function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && url.hostname ? url : null;
  } catch {
    return null;
  }
}

function deployment(project: ProjectData) {
  const host = safeUrl(project.live)?.hostname.replace(/^www\./, "");
  const path = safeUrl(project.github)?.pathname.replace(/\/$/, "");
  const repo = path ? `github.com${path}` : null;
  if (!shipped(project)) {
    const domain = host ?? repo;
    if (!domain) return null;
    return { domain, status: (project.buildState ?? "").toLowerCase(), running: false };
  }
  if (host) return { domain: host, status: "live", running: true };
  if (repo) return { domain: repo, status: "source", running: false };
  return null;
}

function LogEntry({ project, index }: { project: ProjectData; index: number }) {
  const thumb = project.images?.[0];
  const built = shipped(project);
  const drawn = !built && !thumb;
  const linked = built ? Boolean(project.live ?? project.github) : Boolean(project.github);
  const chips = project.technologies.slice(0, PREVIEW_CHIPS);
  const moreChips = project.technologies.length - chips.length;
  const record = deployment(project);

  return (
    <article className="group pb-4 pt-2.5">

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
          <span
            className="inline-flex shrink-0 items-center gap-1.5"
            style={record.running ? { color: OK } : built ? undefined : { color: wipInk(project) }}
          >
            {record.running && <LiveDot />}
            {!built && (drawn || project.buildVersion) && (
              <span
                className="size-[5px] shrink-0 rounded-full"
                style={{ background: project.buildState === "PAUSED" ? LAB_DIM : WIP }}
                aria-hidden
              />
            )}
            {record.status}
          </span>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-[140px_minmax(0,1fr)] items-start gap-3">
        <div
          className="relative rounded-[8px] border p-1.5 transition-[border-color,transform] group-hover:-translate-y-[2px] motion-reduce:transition-none"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "8px 8px",
            borderColor: built
              ? LINE
              : project.buildState === "PAUSED"
                ? LINE
                : "rgba(245,158,11,0.34)",
          }}
        >

          {record?.running && (
            <span
              className="absolute -top-[6px] right-2 flex items-center gap-1 bg-[#0a0a0a] px-1 text-[8px] tracking-[0.16em] text-[#909092] transition-colors group-hover:text-[#fafafa] motion-reduce:transition-none"
              style={{ fontFamily: MONO }}
              aria-hidden
            >
              ▲ prod
            </span>
          )}
          {!built && (drawn || project.buildVersion) && (
            <span
              className="absolute -top-[6px] right-2 flex items-center gap-1 bg-[#0a0a0a] px-1 text-[8px] tracking-[0.16em]"
              style={{ fontFamily: MONO, color: wipInk(project) }}
              aria-hidden
            >
              ▲{drawn ? " plan" : ""}{project.buildVersion ? `${drawn ? " · " : " "}${project.buildVersion}` : ""}
            </span>
          )}
          {drawn ? (
            <MiniBlueprint project={project} />
          ) : (
            <span className="block overflow-hidden rounded-[5px] bg-[#262626]" style={{ aspectRatio: "16 / 10" }}>
              {thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cdnUrl(thumb)} alt="" aria-hidden className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none" />
              )}
            </span>
          )}
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

          {(project.live || project.github || !built) && (
            <div className="mt-2 flex gap-4 text-[9px] tracking-[0.02em] text-[#909092]" style={{ fontFamily: MONO }}>
              {!built && <EtaMarker project={project} />}
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

function PaneNote({ version, projects }: { version: "v1" | "v2"; projects: ProjectData[] }) {
  const built = projects.filter(shipped);
  const inflight = projects.length - built.length;
  const allLive = built.length > 0 && built.every((p) => deployment(p)?.running);

  const note =
    version === "v1"
      ? `${built.length} ${built.length === 1 ? "thing" : "things"} shipped end to end${inflight ? `, ${inflight} still on the board` : ""} — hover a row to spotlight it, tap or click for the highlights.`
      : `${allLive ? "every shipped build below is deployed & running — " : ""}tap or hover a build for the highlights.${inflight ? " A drawn cover is a plan, not a screenshot." : ""}`;

  return (
    <p className="-mt-2 mb-3 text-[9.5px] leading-[1.6]" style={{ color: DIM }}>
      {version === "v2" && (
        <span className="mr-1" style={{ fontFamily: MONO }} aria-hidden="true">⌖</span>
      )}
      {note}
    </p>
  );
}

function EndOfLog({ projects }: { projects: ProjectData[] }) {
  const running = projects.filter((project) => deployment(project)?.running).length;
  const built = projects.filter(shipped).length;
  const building = projects.filter((p) => p.buildState === "BUILDING").length;
  const paused = projects.length - built - building;
  const tally = [
    built > 0 ? `${running}/${built} live` : null,
    building > 0 ? `${building} building` : null,
    paused > 0 ? `${paused} paused` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="mt-5 flex items-center gap-3 text-[8.5px] tracking-[0.2em]" style={{ fontFamily: MONO, color: LAB_DIM }}>
      <span className="h-px flex-1" style={{ background: LINE }} aria-hidden />
      end of build log · {tally}
      <span className="h-px flex-1" style={{ background: LINE }} aria-hidden />
    </div>
  );
}

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
