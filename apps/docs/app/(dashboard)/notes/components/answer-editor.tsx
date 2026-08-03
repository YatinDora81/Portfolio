"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAnswer } from "@/lib/actions/notes";
import { hrefFor } from "@/lib/notes/view-types";

export interface AnswerEditorProps {
  nodeId: string;
  /** Read mode: this same URL without `?edit=1`. */
  href: string;
  /** Where a save lands when the title moved the note's URL out from under us. */
  title: string;
  body: string;
  tags: string[];
}

/**
 * The only editor in the vault, and the only chunk of this section that is not
 * on the page until someone asks for it. Default export because editor-loader.tsx
 * reaches it through `dynamic(() => import("./answer-editor"))`, which resolves
 * the module's default.
 *
 * Everything here is measured against the props it was handed rather than
 * against a dirty flag it maintains: typing a character and typing it back is
 * not an edit, and a flag would insist it was.
 */
export default function AnswerEditor({ nodeId, href, title, body, tags }: AnswerEditorProps) {
  const router = useRouter();
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

      /**
       * Where to land, and why it is not simply `href`.
       *
       * A title change re-slugs the node and rewrites `path` for the whole
       * subtree, so the URL this editor is sitting on stops existing the moment
       * the save commits — and a 404 on a save that succeeded is the worst
       * outcome available here, because the work is safe while the screen says
       * it is gone.
       *
       * Re-deriving the slug with `slugify()` would be wrong exactly when it
       * matters: the write uses `uniqueSlug()`, which appends `-2` when a live
       * sibling already holds the name — the case a user reaches by renaming a
       * note to something they already have. So the action reports the path it
       * actually wrote, and this follows it rather than guessing or retreating
       * to the parent folder.
       */
      router.replace(hrefFor(r.path));
    });

  const discard = () => {
    if (dirty && !window.confirm("Discard the changes you haven't saved?")) return;
    router.replace(href);
  };

  // A box holding the current closures, so the window listener below binds once
  // instead of being torn down and rebuilt on every keystroke.
  const latest = useRef({ save, discard });
  useEffect(() => {
    latest.current = { save, discard };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        // On window rather than on the editor, because ⌘S has to beat the
        // browser's own save dialog wherever the caret happens to be.
        e.preventDefault();
        latest.current.save();
        return;
      }
      // Escape is shared property — the tree's filter box wants it too — so it
      // only discards while the focus is somewhere inside this editor.
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
    // Closing the tab is the one exit React cannot intercept, so it gets the
    // browser's own guard. Bound only while there is something to lose.
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
        <div className="nt-hint">⌘S saves · Esc discards · ``` fences render as code</div>
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
