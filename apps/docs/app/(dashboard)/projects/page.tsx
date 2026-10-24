import { prisma } from "db";
import type { ContentStatus } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  IconPlus, IconFolderCode, IconGripVertical, IconArrowUpRight, IconAlertTriangle,
  IconClock, IconPencil, IconTool,
} from "@tabler/icons-react";
import { livingEta } from "@repo/shared/dates";
import { previewLinkBlockedReason } from "@/lib/actions/preview-link";
import { StatusBadge } from "@/components/lifecycle/status-badge";
import { StatusTabs } from "@/components/lifecycle/status-tabs";
import { RowActions } from "@/components/lifecycle/row-actions";
import { RunDueButton } from "@/components/lifecycle/run-due-button";
import {
  BUILD_LABEL, BUILD_STALE_DAYS, STATUS_LABEL, daysSince, isContentStatus, istLabel,
} from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import { ProjectGrid } from "./grid";
import { ProjectsSections } from "./sections";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

function galleryUrls(gallery: { externalUrl: string | null; asset: { url: string } | null }[]): string[] {
  return gallery.map((img) => img.externalUrl ?? img.asset?.url ?? "").filter(Boolean);
}

export default async function ProjectsPage({ searchParams }: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: requested } = await searchParams;
  const active: ContentStatus | null = isContentStatus(requested) ? requested : null;

  const [projects, settings, previewBlocked] = await Promise.all([
    prisma.project.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        skills: { orderBy: { sortOrder: "asc" }, include: { skill: true } },
        gallery: {
          orderBy: { sortOrder: "asc" },
          select: { externalUrl: true, asset: { select: { url: true } } },
        },
        health: { select: { status: true, latencyMs: true, checkedAt: true } },
        milestones: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    }),
    prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 }, select: { projectsVersion: true } }),
    previewLinkBlockedReason(),
  ]);

  const version = settings.projectsVersion;

  const now = new Date();

  // must not drift from publicContentWhere in db/visibility
  const isLive = (p: { status: ContentStatus; publishedAt: Date | null }) =>
    p.status === "PUBLISHED" && p.publishedAt !== null && p.publishedAt <= now;

  const live = projects.filter(isLive);
  const counts: Record<ContentStatus, number> = { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const p of projects) counts[p.status] += 1;

  const overdue = projects.filter(
    (p) => p.status === "SCHEDULED" && p.publishAt !== null && p.publishAt <= now
  );
  const unstamped = projects.filter((p) => p.status === "PUBLISHED" && p.publishedAt === null);

  const rows = active === null ? projects : projects.filter((p) => p.status === active);

  const withCover = projects.filter(p => p.gallery.length > 0).length;
  const withDemo = projects.filter(p => p.live && p.buildState === "SHIPPED").length;

  const inFlight = projects.filter(p => p.buildState !== "SHIPPED");

  const buildLine = (p: (typeof projects)[number]): { text: string; bad: boolean } | null => {
    if (p.buildState === "SHIPPED") return null;
    const word = BUILD_LABEL[p.buildState].toLowerCase();
    const doing = p.milestones.filter(m => m.state === "DOING");
    const count = `${p.milestones.length} milestone${p.milestones.length === 1 ? "" : "s"}`;

    if (doing.length !== 1) {
      return {
        text: doing.length
          ? `${word} · ${count}, ${doing.length} marked doing — the cover names none of them`
          : `${word} · ${count}, none marked doing`,
        bad: false,
      };
    }

    const stale = daysSince(doing[0]!.updatedAt);
    return {
      text: `${word} · ${doing[0]!.label}: doing for ${stale} day${stale === 1 ? "" : "s"}`,
      bad: stale >= BUILD_STALE_DAYS,
    };
  };

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 05"
        title="Projects"
        description="The case-study cards. Status decides which of them a visitor gets; the running order below decides which three of those open on the page."
      >
        <Link href="/projects/new">
          <Button size="sm"><IconPlus size={14} /> Add project</Button>
        </Link>
      </PageHeader>

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">05</span>
        <div className="sec-anchor">
          <a href={`${SITE}/#projects`} target="_blank" rel="noreferrer">
            #projects <IconArrowUpRight className="nudge" size={11} stroke={1.7} />
          </a>
        </div>
        <div className="sec-reach" />
      </div>

      <ProjectsSections
        version={version}
        previewProjects={live.map(p => ({
          title: p.title,
          summary: p.summary,
          github: p.github,
          live: p.live,
          bullets: p.bullets.map(b => b.content),
          technologies: p.skills.map(s => s.skill.name),
          images: galleryUrls(p.gallery),
          logoUrl: p.logoUrl,
          buildState: p.buildState,
          buildVersion: p.buildVersion,
          etaLabel: p.buildState === "BUILDING" ? livingEta(p.etaLabel, p.updatedAt, now) : null,
          milestones: p.milestones.map(m => ({ label: m.label, state: m.state })),
        }))}
      >
        {overdue.length > 0 && (
          <div className="rv-banner bad" style={{ marginBottom: 14 }}>
            <i><IconClock size={17} stroke={1.7} /></i>
            <div>
              <b>
                {overdue.length} scheduled project{overdue.length === 1 ? " is" : "s are"} past{" "}
                {overdue.length === 1 ? "its" : "their"} publish time and still scheduled
              </b>
              Nothing has run the schedule yet — the time passing does not publish anything by
              itself. Loading any admin page runs the sweep, so a reload of this page should be
              enough; use <b>Publish now</b> on the row if you would rather not wait. If a row is
              still here after a reload, the trigger itself is broken and Revalidation will say so.
              <RunDueButton />
            </div>
          </div>
        )}

        {unstamped.length > 0 && (
          <div className="ico-warn" style={{ marginBottom: 14 }}>
            <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
            <div>
              <b>
                {unstamped.length} project{unstamped.length === 1 ? " is" : "s are"} Published with
                no publish date
              </b>
              A visitor sees a project only when it is Published <em>and</em> it carries a date at
              or before now, so {unstamped.length === 1 ? "this one is" : "these are"} invisible
              despite the badge. Re-saving the project stamps it. This should not be reachable
              through this admin at all — if you are seeing it, the row was written by something
              else.
            </div>
          </div>
        )}

        {projects.length > 0 && (
          <Card flush className="wk-in">
            <CardHead
              title="Publishing"
              count={projects.length}
              right={<span className="card-n">{live.length} on the site</span>}
            />

            <div className="wk-meter">
              <div className="wk-fig"><b className={live.length ? undefined : "q"}>{live.length}</b><span>live</span></div>
              <div className="wk-fig"><b className={counts.SCHEDULED ? undefined : "q"}>{counts.SCHEDULED}</b><span>scheduled</span></div>
              <div className="wk-fig"><b className="q">{counts.DRAFT}</b><span>drafts</span></div>
              <div className="wk-fig"><b className="q">{counts.ARCHIVED}</b><span>archived</span></div>
            </div>

            <StatusTabs base="/projects" active={active} counts={counts} total={projects.length} />

            {active !== null && rows.length === 0 ? (
              <div className="empty">
                <div className="empty-ic"><IconFolderCode size={18} stroke={1.5} /></div>
                <b>No projects are {STATUS_LABEL[active].toLowerCase()}</b>
                <span>
                  All {projects.length} are under a different tab —{" "}
                  <Link href="/projects" className="lc-link">show all</Link>.
                </span>
              </div>
            ) : (
              <div className="rows">
                {rows.map((p) => {
                  const liveNow = isLive(p);
                  const isOverdue = p.status === "SCHEDULED" && p.publishAt !== null && p.publishAt <= now;

                  return (
                    <div key={p.id} className={cn("row", "lc-row", p.status === "ARCHIVED" && "lc-arch")}>
                      <div className="row-main">
                        <div className="row-t">{p.title}</div>
                        <div className="row-m">{p.summary}</div>

                        {p.status === "SCHEDULED" && p.publishAt !== null && !isOverdue && (
                          <div className="lc-line">
                            <IconClock size={12} stroke={1.6} /> goes live {istLabel(p.publishAt)}
                          </div>
                        )}

                        {isOverdue && p.publishAt !== null && (
                          <div className="lc-line bad">
                            <IconAlertTriangle size={12} stroke={1.7} /> was due {istLabel(p.publishAt)} and
                            is still scheduled — nothing has run the schedule
                          </div>
                        )}

                        {p.status === "PUBLISHED" && p.publishedAt === null && (
                          <div className="lc-line bad">
                            <IconAlertTriangle size={12} stroke={1.7} /> published with no date, so
                            the site&rsquo;s filter never matches it — re-save to stamp it
                          </div>
                        )}

                        {(() => {
                          const build = buildLine(p);
                          if (!build) return null;
                          return (
                            <div className={cn("lc-line", build.bad && "bad")}>
                              {build.bad
                                ? <IconAlertTriangle size={12} stroke={1.7} />
                                : <IconTool size={12} stroke={1.7} />}
                              {build.text}
                              {build.bad && " — the drawing looks identical either way"}
                            </div>
                          );
                        })()}

                        <RowActions
                          kind="project"
                          id={p.id}
                          slug={null}
                          title={p.title}
                          status={p.status}
                          previewBlocked={previewBlocked}
                        />
                      </div>

                      <div className="row-acts lc-row-acts">
                        <StatusBadge status={p.status} />
                        {liveNow && (
                          <a
                            className="ibtn"
                            href={`${SITE}/#projects`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open the projects section with ${p.title} on it`}
                            title="Open section 05 on the site"
                          >
                            <IconArrowUpRight size={14} stroke={1.5} className="nudge" />
                          </a>
                        )}
                        <Link href={`/projects/${p.id}`} className="ibtn" aria-label={`Edit ${p.title}`}>
                          <IconPencil size={13} stroke={1.5} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {projects.length > 0 && (
          <Card flush className="wk-in lc-gap">
            <div className="wk-meter" style={{ borderBottom: "none" }}>
              <div className="wk-fig"><b>{projects.length}</b><span>cards</span></div>
              <div className="wk-fig">
                <b className={withCover === projects.length ? undefined : "q"}>{withCover}</b>
                <span>with cover art</span>
              </div>
              <div className="wk-fig">
                <b className={withDemo ? undefined : "q"}>{withDemo}</b>
                <span>with a live demo</span>
              </div>
              <div className="wk-fig">
                <b className={inFlight.length ? undefined : "q"}>{inFlight.length}</b>
                <span>still building</span>
              </div>
              <div className="sp" />
              <span className="hint">
                <IconGripVertical size={13} /> Drag by the grip — the top three render open
              </span>
            </div>
          </Card>
        )}

        <div className="wk-in s1" style={{ marginTop: projects.length > 0 ? 14 : 0 }}>
          {projects.length > 0 && active !== null && (
            <div className="lc-note lc-note-b">
              Showing all {projects.length} cards — the running order is one list, so it cannot be
              dragged through a filter.
            </div>
          )}
          <ProjectGrid
            projects={projects.map((p) => ({
              id: p.id,
              title: p.title,
              summary: p.summary,
              github: p.github,
              live: p.live,
              logoUrl: p.logoUrl,
              cover: galleryUrls(p.gallery)[0] ?? null,
              health: p.health?.status
                ? {
                    status: p.health.status,
                    latencyMs: p.health.latencyMs,
                    probedAt: p.health.checkedAt ? istLabel(p.health.checkedAt) : null,
                  }
                : null,
              bulletCount: p.bullets.length,
              skills: p.skills.map((s) => s.skill.name),
            }))}
          />
        </div>

        {projects.length === 0 && (
          <Card>
            <div className="empty">
              <div className="empty-ic"><IconFolderCode size={19} stroke={1.5} /></div>
              <b>No case studies yet</b>
              <span>Section 05 still renders — visitors get the &ldquo;Work / Projects&rdquo; heading with nothing under it.</span>
              <Link href="/projects/new" style={{ marginTop: 4 }}>
                <Button size="sm"><IconPlus size={14} /> Add the first project</Button>
              </Link>
            </div>
          </Card>
        )}
      </ProjectsSections>
    </div>
  );
}
