import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  IconPlus, IconFolderCode, IconGripVertical, IconArrowUpRight,
} from "@tabler/icons-react";
import { DEFAULTS, keysFor, toProjectsVersion } from "@/lib/site-config-keys";
import { ProjectGrid } from "./grid";
import { ProjectsSections } from "./sections";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

export default async function ProjectsPage() {
  const [projects, siteConfigRows] = await Promise.all([
    prisma.project.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: { bullets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, skills: { select: { name: true } } },
    }),
    prisma.siteConfig.findMany({ where: { key: { in: keysFor("projects") } } }),
  ]);

  const cfg = new Map(siteConfigRows.map((c) => [c.key, c.value]));
  // Coerced here as well as on write, so a row edited around the action still
  // shows the layout visitors are actually being served.
  const version = toProjectsVersion(cfg.get("projectsVersion") ?? DEFAULTS["projectsVersion"]);

  const withCover = projects.filter(p => p.images.length > 0).length;
  const withDemo = projects.filter(p => p.live).length;

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 05"
        title="Projects"
        description="The case-study cards. The first three open on the page and the rest sit behind the section's fold, so the running order below is an editorial decision."
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
        {/* No reaches: nothing outside section 05 reads a Project row. */}
        <div className="sec-reach" />
      </div>

      {/* Everything below the strip is passed as children, not re-rendered on
          the client: `ProjectGrid` stays a server import that way, and only the
          layout row and the pane get state. */}
      <ProjectsSections
        version={version}
        previewProjects={projects.map(p => ({
          title: p.title,
          summary: p.summary,
          github: p.github,
          live: p.live,
          bullets: p.bullets.map(b => b.content),
          technologies: p.skills.map(s => s.name),
          // `images` / `logoUrl` are already loaded above for `ProjectGrid` —
          // without them the preview's cover slot drew an empty grey box on
          // every row, reading as "these projects have no cover art".
          images: p.images,
          logoUrl: p.logoUrl,
        }))}
      >
        {projects.length > 0 && (
          <Card flush className="wk-in" >
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
              <div className="sp" />
              <span className="hint">
                <IconGripVertical size={13} /> Drag by the grip — the top three render open
              </span>
            </div>
          </Card>
        )}

        <div className="wk-in s1" style={{ marginTop: projects.length > 0 ? 14 : 0 }}>
          <ProjectGrid
            projects={projects.map((p) => ({
              id: p.id,
              title: p.title,
              summary: p.summary,
              github: p.github,
              live: p.live,
              logoUrl: p.logoUrl,
              images: p.images,
              bulletCount: p.bullets.length,
              skills: p.skills.map((s) => s.name),
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
