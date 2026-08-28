"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { saveAnswer } from "@/lib/actions/notes";
import { hrefFor } from "@/lib/notes/view-types";
import { unsavedDraft, useNoteNav } from "./vault-provider";

export interface AnswerEditorProps {
  nodeId: string;
  href: string;
  title: string;
  body: string;
  tags: string[];
}

export default function AnswerEditor({ nodeId, href, title, body, tags }: AnswerEditorProps) {
  const go = useNoteNav();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tagLine = tags.join(", ");
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);
  const [draftTags, setDraftTags] = useState(tagLine);

  const dirty = draftTitle !== title || draftBody !== body || draftTags !== tagLine;

  const save = () =>
    start(async () => {
      setError(null);
      const clean = draftTitle.trim();
      const renamed = clean !== title;
      const r = await saveAnswer(nodeId, {
        title: renamed ? clean : undefined,
        body: draftBody,
        tags: draftTags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }

      go(hrefFor(r.path), { replace: true, afterWrite: true });
    });

  const discard = () => {
    if (dirty && !window.confirm("Discard the changes you haven't saved?")) return;
    unsavedDraft.current = false;
    go(href, { replace: true });
  };

  useEffect(() => {
    unsavedDraft.current = dirty;
    return () => {
      unsavedDraft.current = false;
    };
  }, [dirty]);

  const latest = useRef({ save, discard });
  useEffect(() => {
    latest.current = { save, discard };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        latest.current.save();
        return;
      }
      if (e.key === "Escape" && root.current?.contains(document.activeElement)) {
        e.preventDefault();
        latest.current.discard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div ref={root}>
      <div className="nt-field">
        <label className="nt-lb" htmlFor={`${id}-t`}>question</label>
        <input
          id={`${id}-t`}
          className="nt-in"
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
        />
      </div>

      <div className="nt-field">
        <label className="nt-lb" htmlFor={`${id}-b`}>answer · markdown</label>
        <textarea
          id={`${id}-b`}
          className="nt-ta"
          value={draftBody}
          spellCheck
          onChange={(e) => setDraftBody(e.target.value)}
        />
        <div className="nt-hint">
          ⌘S saves · Esc discards · ``` fences render as code · <code>::: quiz</code> ·{" "}
          <code>::: details</code> · <code>::: note</code> / <code>tip</code> / <code>warn</code>
        </div>
      </div>

      <div className="nt-field">
        <label className="nt-lb" htmlFor={`${id}-g`}>tags</label>
        <input
          id={`${id}-g`}
          className="nt-in"
          value={draftTags}
          placeholder="comma separated"
          onChange={(e) => setDraftTags(e.target.value)}
        />
      </div>

      <div className="nt-acts">
        <button className="btn pri" type="button" disabled={pending || !dirty} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button className="btn" type="button" onClick={discard}>
          Cancel
        </button>
        {dirty ? <span className="nt-dirty">unsaved</span> : null}
        <span className="nt-stamp">renaming rewrites the subtree path</span>
      </div>
      {error ? <p className="nt-hint nt-bad" role="alert">{error}</p> : null}
    </div>
  );
}
