"use client";

import { useState, useTransition } from "react";
import { IconFilePlus, IconFolderPlus } from "@tabler/icons-react";
import { createNode } from "@/lib/actions/notes";
import { hrefFor, type NoteKind } from "@/lib/notes/view-types";
import { useNoteNav } from "./vault-provider";

export function NewNoteButtons({ parentId }: { parentId: string | null }) {
  const go = useNoteNav();
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
      go(hrefFor(r.path), { afterWrite: true });
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
