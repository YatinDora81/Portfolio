"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

/**
 * Scroll the tree to the note the reader is showing.
 *
 * The tree lives in the layout, so nothing here holds a reference to it and no
 * props reach across. Scrolling needs none: navigating already expands every
 * ancestor of the open note, so its row is mounted and carries `.sel` — a class
 * both halves are written against — and finding it is one query.
 *
 * Expanding is the part that cannot be done from here, and it is only needed in
 * one case: a folder the user collapsed by hand *after* arriving, which the
 * tree's additive reveal effect deliberately leaves alone. The event is the hook
 * for that case. Nothing listens for it yet, so today the button scrolls and
 * that is all it claims to do.
 */
export function RevealInTree({ path }: { path: string }) {
  return (
    <button
      type="button"
      className="nt-reveal"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("notes:reveal", { detail: { path } }));
        // A frame later, so a listener that expands has committed before we aim
        // at the row. Scrolling first would centre on what is still hidden.
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
  /** The note's own URL. Edit hangs `?edit=1` off it. */
  href: string;
  /** Where a trash or a rename lands, because neither leaves this URL standing. */
  parentHref: string;
  /** The right-hand line: revision stamp and materialised path. */
  stamp: string;
  /** Rendered first inside the row; the folder overview puts its create pair here. */
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
  const router = useRouter();
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
      // `saveAnswer` with only a title IS a rename — it delegates to the same
      // `renameIn` — and unlike `renameNode` it reports the path the write
      // landed on. Renaming rewrites this note's URL, so following the reported
      // path is what keeps the reader on the note instead of dropping it at the
      // folder above. Guessing the slug would be wrong exactly when
      // `uniqueSlug` appends `-2`.
      const r = await saveAnswer(id, { title: next });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRenaming(false);
      router.replace(hrefFor(r.path));
    });

  const duplicate = () =>
    start(async () => {
      setError(null);
      const r = await duplicateNode(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(hrefFor(r.path));
    });

  const trash = () =>
    start(async () => {
      setError(null);
      const r = await trashNode(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Whatever was open is no longer at this URL. Staying is a 404 on a page
      // the user is already looking at.
      router.replace(parentHref);
    });

  // `window.confirm` rather than the admin's Dialog: this section styles itself
  // entirely out of the `.nt-*` sheet, and the prompt is here to catch a
  // mis-click, not to explain a loss — trashing is soft and /notes/trash undoes
  // it. The wording names the cascade, which is the part that surprises people.
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
              <Link className="btn" href={`${href}?edit=1`}>
                <IconPencil size={13} stroke={1.7} /> Edit
              </Link>
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
          {/* Every format the route serves, not one guessed here. This used to
              be a bare anchor at a fixed `format=`, which made JSON unreachable
              from the reader and flat markdown unreachable from a folder even
              though /notes/export answers both. */}
          <ExportMenu nodeId={id} kind={kind} title={title} />
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
