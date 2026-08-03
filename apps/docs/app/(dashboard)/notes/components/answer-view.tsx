import { Fragment } from "react";
import Link from "next/link";
import { renderMarkdown } from "@/lib/notes/markdown";
import { NOTES_ROOT, type Crumb, type QuestionView } from "@/lib/notes/view-types";
import { ConfidenceDots } from "./confidence-dots";
import { EditorLoader } from "./editor-loader";
import { NoteActions, RevealInTree } from "./note-actions";
import { TagEditor } from "./tag-editor";

/**
 * The reader. A Server Component, and it stays one: the answer body is turned
 * into elements here by renderMarkdown, so opening a note ships prose and not a
 * parser. The only client code on the page is the three small controls that
 * write — tags, confidence, the action row — plus the shim that can fetch the
 * editor if it is ever asked to.
 */
export function AnswerView({
  node,
  siblings,
  parentTitle,
}: {
  node: QuestionView;
  siblings: { id: string; title: string; href: string }[];
  parentTitle: string;
}) {
  const { answer } = node;
  const parentHref = parentHrefOf(node.crumbs);

  return (
    <article>
      {/* Outside the editor gate: the crumbs are how you leave a note, and
          leaving is exactly what someone who opened the editor by accident is
          trying to do. */}
      <NoteCrumbs crumbs={node.crumbs} path={node.path} />

      <EditorLoader
        nodeId={node.id}
        href={node.href}
        title={node.title}
        body={answer.body}
        tags={answer.tags}
      >
        <h1 className="nt-title">{node.title}</h1>

        <div className="nt-meta">
          <TagEditor nodeId={node.id} tags={answer.tags} />
          <ConfidenceDots nodeId={node.id} value={answer.confidence} />
        </div>

        <div className="nt-answer">
          {answer.body.trim()
            ? renderMarkdown(answer.body)
            : <p className="nt-empty">No answer yet. Edit to write one.</p>}
        </div>

        {siblings.length ? (
          <nav className="nt-sibs" aria-label={`Other questions in ${parentTitle}`}>
            <div className="nt-sibs-lb">also in {parentTitle}</div>
            <div className="nt-sibs-row">
              {siblings.map((s) => (
                <Link className="nt-sib" key={s.id} href={s.href}>{s.title}</Link>
              ))}
            </div>
          </nav>
        ) : null}

        <NoteActions
          id={node.id}
          kind="QUESTION"
          title={node.title}
          href={node.href}
          parentHref={parentHref}
          stamp={`${revisedStamp(answer.lastRevisedAt)} · ${node.path}`}
        />
      </EditorLoader>
    </article>
  );
}

/**
 * Shared with the folder overview, and living here because the reader is the
 * page it was drawn for. Server-rendered on purpose: a breadcrumb is a row of
 * links, and the one interactive thing in it — reveal — is the only part that
 * needs to be a client component.
 */
export function NoteCrumbs({ crumbs, path }: { crumbs: Crumb[]; path: string }) {
  const trail = crumbs.slice(0, -1);
  const here = crumbs[crumbs.length - 1];

  return (
    <nav className="nt-crumb" aria-label="Breadcrumb">
      {trail.map((c) => (
        <Fragment key={c.href}>
          <Link href={c.href}>{c.title}</Link>
          <span className="nt-crumb-sep" aria-hidden>/</span>
        </Fragment>
      ))}
      {/* The last crumb is where you already are, so it is text. A link back to
          the current page is a promise of movement that isn't kept. */}
      <span aria-current="page">{here?.title}</span>
      <RevealInTree path={path} />
    </nav>
  );
}

/** The nearest URL that survives a rename or a trash of the node itself. */
export function parentHrefOf(crumbs: Crumb[]): string {
  return crumbs.length > 1 ? crumbs[crumbs.length - 2]!.href : NOTES_ROOT;
}

export function revisedStamp(iso: string | null): string {
  if (!iso) return "never revised";
  const d = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `revised ${d}`;
}

/**
 * The reader does not serialise anything, and it no longer names a format
 * either: `<ExportMenu>` inside the action row offers every one /notes/export
 * actually answers, so the choice belongs to the user rather than to whichever
 * component happened to render the button.
 */
