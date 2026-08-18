import { Fragment } from "react";
import { renderMarkdown } from "@/lib/notes/markdown";
import type { NextQuestion } from "@/lib/notes/vault-view";
import { NOTES_ROOT, type Crumb, type QuestionView } from "@/lib/notes/view-types";
import { ConfidenceDots } from "./confidence-dots";
import { EditorLoader } from "./editor-loader";
import { NoteActions, RevealInTree } from "./note-actions";
import { ScrollAdvance } from "./scroll-advance";
import { TagEditor } from "./tag-editor";
import { NoteLink } from "./vault-provider";

/**
 * The reader.
 *
 * It was a Server Component, so that opening a note shipped prose rather than a
 * parser. It is a client one now, and the trade is worth naming: `renderMarkdown`
 * costs about ten kilobytes and was already in the browser anyway — the revise
 * deck imports the same function — while every note the reader draws from memory
 * saves three round trips to Neon. Ten kilobytes once against most of a second
 * every time somebody clicks a question.
 *
 * Nothing else moved. The body still becomes elements rather than an HTML
 * string, and the same three controls still do the writing.
 */
export function AnswerView({
  node,
  siblings,
  parentTitle,
  next,
}: {
  node: QuestionView;
  siblings: { id: string; title: string; href: string }[];
  parentTitle: string;
  next: NextQuestion | null;
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
                <NoteLink className="nt-sib" key={s.id} href={s.href}>{s.title}</NoteLink>
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

        {/* Last inside the editor gate, and both halves of that matter: last,
            because "the bottom" has to mean below the sibling strip and the
            action row; inside the gate, because opening the editor must unmount
            the gesture along with the prose. */}
        <ScrollAdvance next={next} />
      </EditorLoader>
    </article>
  );
}

/**
 * Shared with the folder overview, and living here because the reader is the
 * page it was drawn for. A breadcrumb is a row of links; the only reason any of
 * it is interactive is reveal, at the end.
 */
export function NoteCrumbs({ crumbs, path }: { crumbs: Crumb[]; path: string }) {
  const trail = crumbs.slice(0, -1);
  const here = crumbs[crumbs.length - 1];

  return (
    <nav className="nt-crumb" aria-label="Breadcrumb">
      {trail.map((c) => (
        <Fragment key={c.href}>
          <NoteLink href={c.href}>{c.title}</NoteLink>
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
