import Link from "next/link";
import { IconFileText, IconFolder } from "@tabler/icons-react";
import type { FolderView } from "@/lib/notes/view-types";
import { NoteCrumbs, parentHrefOf } from "./answer-view";
import { NewNoteButtons } from "./new-note-buttons";
import { NoteActions } from "./note-actions";

/**
 * What a folder is, rather than what it contains: three numbers, the things you
 * can do to it, and the level immediately below. Nothing here recurses — the
 * tree in the left pane already draws the shape of the whole vault, and a second
 * copy of it in the reading pane would be two answers to the same question.
 */
export function FolderOverview({ node }: { node: FolderView }) {
  const { stats } = node;

  return (
    <article>
      <NoteCrumbs crumbs={node.crumbs} path={node.path} />
      <h1 className="nt-title">{node.title}</h1>

      <div className="nt-stat">
        <div>
          <div className="nt-sv">{stats.questions}</div>
          <div className="nt-sl">questions</div>
        </div>
        <div>
          <div className="nt-sv">{stats.folders}</div>
          <div className="nt-sl">subfolders</div>
        </div>
        <div>
          <div className="nt-sv">{stats.solidPct}%</div>
          <div className="nt-sl">solid</div>
        </div>
      </div>

      <NoteActions
        id={node.id}
        kind="FOLDER"
        title={node.title}
        href={node.href}
        parentHref={parentHrefOf(node.crumbs)}
        stamp={node.path}
      >
        <NewNoteButtons parentId={node.id} />
      </NoteActions>

      {node.children.length ? (
        <div className="nt-list">
          {node.children.map((c) => (
            <Link className="nt-litem" key={c.id} href={c.href}>
              <span className="nt-lic" aria-hidden>
                {c.kind === "FOLDER"
                  ? <IconFolder size={15} stroke={1.6} />
                  : <IconFileText size={15} stroke={1.6} />}
              </span>
              <span className="nt-lt">{c.title}</span>
              <span className="nt-lm">{c.meta}</span>
            </Link>
          ))}
        </div>
      ) : (
        // Named as empty rather than left blank. A folder with nothing in it and
        // a folder that failed to load look identical otherwise.
        <p className="nt-empty">
          Nothing in here yet. Add a question, or a subfolder to sort the ones coming.
        </p>
      )}
    </article>
  );
}
