"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  IconCards,
  IconCopy,
  IconCrosshair,
  IconCursorText,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { duplicateNode, saveAnswer, trashNode } from "@/lib/actions/notes";
import { hrefFor, type NoteKind } from "@/lib/notes/view-types";
import { ExportMenu } from "./export-menu";
import { ImportButton } from "./import-dialog";
import { NoteLink, useNoteNav } from "./vault-provider";

export function RevealInTree({ path }: { path: string }) {
  return (
    <button
      type="button"
      className="nt-reveal"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("notes:reveal", { detail: { path } }));
        // let the expand commit before we aim at the row
        requestAnimationFrame(() =>
          document.querySelector(".nt-scroll .nt-item.sel")?.scrollIntoView({ block: "center" }),
        );
      }}
    >
      <IconCrosshair size={12} stroke={1.6} /> reveal in tree
    </button>
  );
}

export interface NoteActionsProps {
  id: string;
  kind: NoteKind;
  title: string;
  href: string;
  parentHref: string;
  stamp: string;
  children?: ReactNode;
}

export function NoteActions({
  id,
  kind,
  title,
  href,
  parentHref,
  stamp,
  children,
}: NoteActionsProps) {
  const go = useNoteNav();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);

  const folder = kind === "FOLDER";

  const rename = () =>
    start(async () => {
      const next = draft.trim();
      setError(null);
      if (!next || next === title) {
        setRenaming(false);
        return;
      }
      const r = await saveAnswer(id, { title: next });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRenaming(false);
      go(hrefFor(r.path), { replace: true, afterWrite: true });
    });

  const duplicate = () =>
    start(async () => {
      setError(null);
      const r = await duplicateNode(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      go(hrefFor(r.path), { afterWrite: true });
    });

  const trash = () =>
    start(async () => {
      setError(null);
      const r = await trashNode(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      go(parentHref, { replace: true, afterWrite: true });
    });

  const confirmTrash = () => {
    const what = folder
      ? `Move “${title}” and everything inside it to the trash?`
      : `Move “${title}” to the trash?`;
    if (window.confirm(what)) trash();
  };

  return (
    <>
      {renaming ? (
        <form
          className="nt-inline"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
          }}
        >
          <span className="nt-ic" aria-hidden>
            <IconCursorText size={14} stroke={1.6} />
          </span>
          <input
            className="nt-inline-in"
            autoFocus
            size={30}
            value={draft}
            aria-label={`Rename ${title}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(title);
                setRenaming(false);
              }
            }}
          />
          <button className="btn pri" type="submit" disabled={pending || !draft.trim()}>
            Rename
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setDraft(title);
              setRenaming(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="nt-acts">
          {children}
          {folder ? null : (
            <>
              <NoteLink className="btn" href={`${href}?edit=1`}>
                <IconPencil size={13} stroke={1.7} /> Edit
              </NoteLink>
              <Link className="btn" href="/notes/revise">
                <IconCards size={13} stroke={1.7} /> Revise
              </Link>
            </>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => {
              setDraft(title);
              setRenaming(true);
            }}
          >
            <IconCursorText size={13} stroke={1.7} /> Rename
          </button>
          {folder ? null : (
            <button className="btn" type="button" disabled={pending} onClick={duplicate}>
              <IconCopy size={13} stroke={1.7} /> Duplicate
            </button>
          )}
          {/* every format the route serves, not one guessed here */}
          <ExportMenu nodeId={id} kind={kind} title={title} />
          {/* only a folder has somewhere to graft into */}
          {folder ? <ImportButton parentId={id} parentTitle={title} /> : null}
          <button className="btn danger" type="button" disabled={pending} onClick={confirmTrash}>
            <IconTrash size={13} stroke={1.7} /> Trash
          </button>
          <span className="nt-stamp">{stamp}</span>
        </div>
      )}
      {error ? <p className="nt-hint nt-bad" role="alert">{error}</p> : null}
    </>
  );
}
