"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconFilePlus, IconFolderPlus } from "@tabler/icons-react";
import { createNode } from "@/lib/actions/notes";
import { hrefFor, type NoteKind } from "@/lib/notes/view-types";

/**
 * The two create buttons, and the one input they open into.
 *
 * `createNode` answers with the path it actually wrote, collision suffix and
 * all, so this is the one write in the section that can navigate to its own
 * result with certainty. Every other path-moving action has to guess or land
 * somewhere it knows exists — see answer-editor.tsx.
 */
export function NewNoteButtons({ parentId }: { parentId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<NoteKind | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setKind(null);
    setTitle("");
  };

  const create = (k: NoteKind) =>
    start(async () => {
      setError(null);
      const r = await createNode(parentId, k, title);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      router.push(hrefFor(r.path));
    });

  if (kind) {
    const folder = kind === "FOLDER";
    return (
      <form
        className="nt-inline"
        onSubmit={(e) => {
          e.preventDefault();
          create(kind);
        }}
      >
        <span className="nt-ic" aria-hidden>
          {folder ? <IconFolderPlus size={14} stroke={1.6} /> : <IconFilePlus size={14} stroke={1.6} />}
        </span>
        <input
          className="nt-inline-in"
          autoFocus
          size={26}
          value={title}
          placeholder={folder ? "Folder name" : "Ask a question"}
          aria-label={folder ? "New folder name" : "New question"}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        />
        <button className="btn pri" type="submit" disabled={pending || !title.trim()}>
          {pending ? "Creating…" : "Create"}
        </button>
        <button className="btn ghost" type="button" onClick={close}>
          Cancel
        </button>
        {error ? <span className="nt-hint nt-bad" role="alert">{error}</span> : null}
      </form>
    );
  }

  return (
    <>
      <button className="btn" type="button" onClick={() => setKind("FOLDER")}>
        <IconFolderPlus size={14} stroke={1.6} /> New folder
      </button>
      <button className="btn pri" type="button" onClick={() => setKind("QUESTION")}>
        <IconFilePlus size={14} stroke={1.6} /> New question
      </button>
      {error ? <span className="nt-hint nt-bad" role="alert">{error}</span> : null}
    </>
  );
}
