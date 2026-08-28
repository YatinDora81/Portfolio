import { IconFileText, IconFolder } from "@tabler/icons-react";
import type { FolderView } from "@/lib/notes/view-types";
import { NoteCrumbs, parentHrefOf } from "./answer-view";
import { NewNoteButtons } from "./new-note-buttons";
import { NoteActions } from "./note-actions";
import { NoteLink } from "./vault-provider";

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
            <NoteLink className="nt-litem" key={c.id} href={c.href}>
              <span className="nt-lic" aria-hidden>
                {c.kind === "FOLDER"
                  ? <IconFolder size={15} stroke={1.6} />
                  : <IconFileText size={15} stroke={1.6} />}
              </span>
              <span className="nt-lt">{c.title}</span>
              <span className="nt-lm">{c.meta}</span>
            </NoteLink>
          ))}
        </div>
      ) : (
        <p className="nt-empty">
          Nothing in here yet. Add a question, or a subfolder to sort the ones coming.
        </p>
      )}
    </article>
  );
}
