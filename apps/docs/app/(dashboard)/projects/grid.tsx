"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  IconPencil, IconBrandGithub, IconWorld, IconGripVertical,
  IconChevronUp, IconChevronDown,
} from "@tabler/icons-react";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteProject, reorderProjects } from "@/lib/actions/projects";
import { cdnUrl } from "@/lib/utils";
import { useSortable } from "@/lib/use-sortable";

export interface ProjectCard {
  id: string;
  title: string;
  summary: string;
  github: string | null;
  live: string | null;
  logoUrl: string | null;
  images: string[];
  bulletCount: number;
  skills: string[];
}

/**
 * Cover art fallback: a deterministic hsl tint derived from the card's index,
 * so a project without artwork still gets a stable, distinct cover.
 */
function tintFor(i: number) {
  const h = (i * 47 + 208) % 360;
  return `linear-gradient(135deg, hsl(${h} 64% 62%), hsl(${(h + 44) % 360} 58% 46%))`;
}

export function ProjectGrid({ projects }: { projects: ProjectCard[] }) {
  const [pending, startTransition] = useTransition();
  const byId = new Map(projects.map((p) => [p.id, p]));

  const { order, dragId, handleProps, itemProps } = useSortable(
    projects.map((p) => p.id),
    (ids) => startTransition(async () => { await reorderProjects(ids); }),
    { disabled: pending }
  );

  return (
    <div className="proj-grid">
      {order.map((id, i) => {
        const p = byId.get(id);
        if (!p) return null;
        const cover = p.images?.[0];

        return (
          <article key={p.id} className="pcard sortable" {...itemProps(p.id)}>
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
              {/* Drag from here, not the whole card — the cover holds links. */}
              <span
                className="pgrip"
                title="Drag to reorder"
                aria-hidden
                {...handleProps(p.id)}
              >
                <IconGripVertical size={14} stroke={1.7} />
              </span>

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
                    <span key={s} className="chip">{s}</span>
                  ))}
                </div>
              )}

              <div className="pfoot">
                <span className="card-n">
                  {p.bulletCount} bullet{p.bulletCount === 1 ? "" : "s"}
                </span>
                <div className="sp" />

                {/* Keyboard path — drag is pointer-only, so order stays reachable. */}
                <button
                  className="ibtn move"
                  aria-label={`Move ${p.title} earlier`}
                  disabled={i === 0 || pending}
                  onClick={() => startTransition(async () => {
                    const next = [...order];
                    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                    await reorderProjects(next);
                  })}
                >
                  <IconChevronUp size={14} stroke={1.7} />
                </button>
                <button
                  className="ibtn move"
                  aria-label={`Move ${p.title} later`}
                  disabled={i === order.length - 1 || pending}
                  onClick={() => startTransition(async () => {
                    const next = [...order];
                    [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
                    await reorderProjects(next);
                  })}
                >
                  <IconChevronDown size={14} stroke={1.7} />
                </button>

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
                  onDelete={async () => { await deleteProject(p.id); }}
                />
              </div>
            </div>
          </article>
        );
      })}
      {dragId && <span className="sr-only" role="status">Reordering…</span>}
    </div>
  );
}
