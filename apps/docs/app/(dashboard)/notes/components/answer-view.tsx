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

        <ScrollAdvance next={next} />
      </EditorLoader>
    </article>
  );
}

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
      <span aria-current="page">{here?.title}</span>
      <RevealInTree path={path} />
    </nav>
  );
}

export function parentHrefOf(crumbs: Crumb[]): string {
  return crumbs.length > 1 ? crumbs[crumbs.length - 2]!.href : NOTES_ROOT;
}

export function revisedStamp(iso: string | null): string {
  if (!iso) return "never revised";
  const d = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `revised ${d}`;
}
