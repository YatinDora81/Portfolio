import { prisma } from "db";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteProject } from "@/lib/actions/projects";
import { cdnUrl } from "@/lib/utils";
import {
  IconPlus, IconPencil, IconBrandGithub, IconWorld, IconFolderCode, IconPhoto,
} from "@tabler/icons-react";
import { PreviewFrame, ProjectsPreview } from "@/components/preview";

/**
 * Cover art fallback: a deterministic hsl tint derived from the card's index,
 * so a project without artwork still gets a stable, distinct cover.
 */
function tintFor(i: number) {
  const h = (i * 47 + 208) % 360;
  return `linear-gradient(135deg, hsl(${h} 64% 62%), hsl(${(h + 44) % 360} 58% 46%))`;
}

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { sortOrder: "asc" },
    include: { bullets: { orderBy: { sortOrder: "asc" } }, skills: { select: { name: true } } },
  });

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 05"
        title="Projects"
        description="The case-study cards on the portfolio — cover art, stack and the repo/demo links."
      >
        <Link href="/projects/new">
          <Button size="sm"><IconPlus size={14} /> Add project</Button>
        </Link>
      </PageHeader>

      {projects.length > 0 && (
        <div className="card-h" style={{ border: "none", padding: "0 2px 10px" }}>
          <span className="card-t">All projects</span>
          <span className="card-n">/ {String(projects.length).padStart(2, "0")}</span>
          <div className="sp" />
          <span className="hint">
            <IconPhoto size={13} /> Cover comes from the first image URL, else the project logo
          </span>
        </div>
      )}

      <div className="proj-grid">
        {projects.map((p, i) => {
          const cover = p.images?.[0];
          return (
            <article key={p.id} className="pcard">
              <div
                className="pcover"
                style={
                  cover
                    ? {
                        backgroundImage: `url("${cdnUrl(cover)}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : { background: tintFor(i) }
                }
              >
                <span className="pnum">P.{String(i + 1).padStart(2, "0")}</span>

                {p.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cdnUrl(p.logoUrl)}
                    alt=""
                    style={{
                      position: "absolute",
                      top: 9,
                      right: 10,
                      width: 34,
                      height: 34,
                      padding: 5,
                      objectFit: "contain",
                      borderRadius: 10,
                      background: "var(--chipG)",
                      border: "1px solid var(--line2)",
                      backdropFilter: "blur(6px)",
                    }}
                  />
                )}

                {p.live ? (
                  <span className="chip on"><span className="dot" /> Live</span>
                ) : (
                  <span className="chip off"><span className="dot" /> No demo</span>
                )}
              </div>

              <div className="pbody">
                <div className="pt">{p.title}</div>
                <div className="ptag">{p.summary}</div>

                {p.skills.length > 0 && (
                  <div className="pskills">
                    {p.skills.map((s) => (
                      <span key={s.name} className="chip">{s.name}</span>
                    ))}
                  </div>
                )}

                <div className="pfoot">
                  <span className="card-n">
                    {p.bullets.length} bullet{p.bullets.length === 1 ? "" : "s"}
                  </span>
                  <div className="sp" />
                  {p.github && (
                    <a
                      className="ibtn"
                      href={p.github}
                      target="_blank"
                      rel="noreferrer"
                      title="Open repository"
                      aria-label={`Repository for ${p.title}`}
                    >
                      <IconBrandGithub size={15} stroke={1.5} />
                    </a>
                  )}
                  {p.live && (
                    <a
                      className="ibtn"
                      href={p.live}
                      target="_blank"
                      rel="noreferrer"
                      title="Open live demo"
                      aria-label={`Live demo of ${p.title}`}
                    >
                      <IconWorld size={15} stroke={1.5} />
                    </a>
                  )}
                  <Link
                    className="ibtn"
                    href={`/projects/${p.id}`}
                    title="Edit"
                    aria-label={`Edit ${p.title}`}
                  >
                    <IconPencil size={15} stroke={1.5} />
                  </Link>
                  <DeleteButton
                    label={`"${p.title}"`}
                    sub="Deletes the project and its bullet points. This can't be undone."
                    onDelete={async () => { "use server"; await deleteProject(p.id); }}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {projects.length === 0 && (
        <Card>
          <div className="empty">
            <div className="empty-ic"><IconFolderCode size={19} stroke={1.5} /></div>
            <b>No projects yet</b>
            <span>Section 05 stays hidden until the first project lands here.</span>
            <Link href="/projects/new" style={{ marginTop: 4 }}>
              <Button size="sm"><IconPlus size={14} /> Add project</Button>
            </Link>
          </div>
        </Card>
      )}

      <PreviewFrame label="Projects Preview">
        <ProjectsPreview projects={projects.map(p => ({ title: p.title, summary: p.summary, github: p.github, live: p.live, bullets: p.bullets.map(b => b.content), technologies: p.skills.map(s => s.name) }))} />
      </PreviewFrame>
    </div>
  );
}
