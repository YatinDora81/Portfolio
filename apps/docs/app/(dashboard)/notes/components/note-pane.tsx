"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  folderViewIn, nextQuestionIn, parentTitleIn, questionViewIn, siblingsIn, type VaultRow,
} from "@/lib/notes/vault-view";
import { hrefFor, isReservedNotePath, NOTES_ROOT, notePathOf } from "@/lib/notes/view-types";
import { AnswerView } from "./answer-view";
import { FolderOverview } from "./folder-overview";
import { NotesBlank } from "./notes-blank";
import { NoteLink, useNoteNav, useVault } from "./vault-provider";

export function NotePane() {
  const ix = useVault();
  const go = useNoteNav();
  const pathname = usePathname();
  const notePath = notePathOf(pathname);

  const open = useRef<{ id: string; path: string } | null>(null);
  const here = notePath ? ix.byPath.get(notePath) : undefined;
  const was = open.current;
  const moved =
    notePath && !here && was && !ix.byPath.has(was.path) ? ix.byId.get(was.id) : undefined;
  const row = here ?? moved;

  useEffect(() => {
    open.current = row ? { id: row.id, path: row.path } : null;
  }, [row]);

  useEffect(() => {
    if (!moved) return;
    const href = hrefFor(moved.path);
    if (href !== pathname) go(href, { replace: true, afterWrite: true });
  }, [moved, pathname, go]);

  useEffect(() => {
    const name = row?.title ?? (notePath === "" ? "Notes" : "Not in the vault");
    document.title = `${name} · Notes`;
  }, [row, notePath]);

  if (isReservedNotePath(pathname)) return null;
  if (notePath === "") return <NotesBlank vaultEmpty={ix.vaultEmpty} />;
  if (notePath === null || !row) return <Gone />;
  // keyed so control state does not carry over between notes
  if (row.kind === "FOLDER") return <FolderOverview key={row.id} node={folderViewIn(ix, row)} />;
  return <Question key={row.id} ix={ix} row={row} />;
}

function Question({ ix, row }: { ix: ReturnType<typeof useVault>; row: VaultRow }) {
  const node = questionViewIn(ix, row);
  return (
    <AnswerView
      node={node}
      siblings={siblingsIn(ix, row)}
      parentTitle={parentTitleIn(node.crumbs)}
      next={nextQuestionIn(ix, row)}
    />
  );
}

function Gone() {
  return (
    <div className="nt-blank">
      <h1 className="nt-blank-h">Not in the vault</h1>
      <p className="nt-blank-p">
        Nothing here answers to that address. It may have been trashed, or renamed out from under
        the link — the tree on the left is the shortest way to whatever took its place.
      </p>
      <div className="nt-blank-row">
        {/* trash is a real route, the vault is already in memory */}
        <NoteLink className="btn" href={NOTES_ROOT}>
          Back to the vault
        </NoteLink>
        <Link className="btn ghost" href={`${NOTES_ROOT}/trash`} prefetch={false}>
          Trash
        </Link>
      </div>
    </div>
  );
}
