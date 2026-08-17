"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  folderViewIn, parentTitleIn, questionViewIn, siblingsIn, type VaultRow,
} from "@/lib/notes/vault-view";
import { hrefFor, isReservedNotePath, NOTES_ROOT, notePathOf } from "@/lib/notes/view-types";
import { AnswerView } from "./answer-view";
import { FolderOverview } from "./folder-overview";
import { NotesBlank } from "./notes-blank";
import { NoteLink, useNoteNav, useVault } from "./vault-provider";

/**
 * The reading pane, resolved from the URL against the vault already in memory.
 *
 * This used to be the page's job, and the page did it with three or four
 * queries: the row, its ancestors' titles, and then either its siblings or its
 * folder's children and stats. All of that is now arithmetic over the payload
 * the layout loaded once, which is what makes clicking through a folder feel
 * like scrolling rather than like browsing.
 *
 * It reads `usePathname()` rather than `params` on purpose. The tree moves
 * between notes with `history.pushState` — no request, no re-render of anything
 * above — and `params` would still be describing the note the last real
 * navigation landed on.
 */
export function NotePane() {
  const ix = useVault();
  const go = useNoteNav();
  const pathname = usePathname();
  const notePath = notePathOf(pathname);

  /**
   * A rename or a move rewrites `path` while the browser is still parked on the
   * old one. Rather than blink a "gone" pane at a note that is perfectly fine,
   * the row is re-found by id and the address bar is corrected afterwards — the
   * same trick the tree used to play with `router.replace`, done where the
   * knowledge actually is, so it covers a rename from the editor and from the
   * action row as well as from the sidebar.
   *
   * Three conditions, and each one is load-bearing. We have to be looking at a
   * note (`notePath`), or renaming from the vault root would drag the address
   * bar onto a note the reader has already left. The address we were last
   * rendering has to have LEFT the vault, or a typed path that never existed
   * would silently resolve to whatever was open before it. And the anchor is
   * dropped the moment the reader does, so it can never outlive the view it
   * describes.
   */
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
    // Through the hook, not a raw `replaceState`. This fires as a consequence of
    // a write's payload landing, which is precisely when a second write may
    // still be in flight — and a bare history call would mark that one discarded.
    if (href !== pathname) go(href, { replace: true, afterWrite: true });
  }, [moved, pathname, go]);

  /**
   * The tab title, which is doing more work here than it looks.
   *
   * Next's route announcer speaks on a title change and nothing else, so a
   * screen-reader user was told nothing when the whole reading pane was replaced
   * — the title has been the constant "Admin Dashboard" for all 386 questions.
   * A server component could have fixed that with `generateMetadata`; this one
   * cannot, because it never re-renders on the server any more. So it sets the
   * title itself, and gets the announcement, the tab label and a history entry
   * you can recognise in the Back menu out of the same line.
   */
  useEffect(() => {
    const name = row?.title ?? (notePath === "" ? "Notes" : "Not in the vault");
    document.title = `${name} · Notes`;
  }, [row, notePath]);

  // A sibling route owns the pane; this one is mounted only mid-transition.
  if (isReservedNotePath(pathname)) return null;
  if (notePath === "") return <NotesBlank vaultEmpty={ix.vaultEmpty} />;
  // `null` here is an address that would not decode, which is a miss like any
  // other — and unlike the case above, one the reader has to say something about.
  if (notePath === null || !row) return <Gone />;
  // Keyed on the note, and not for React's benefit. Moving between notes no
  // longer unmounts anything — same component, same position, new props — so a
  // control holding state seeded from a prop (`TagEditor`'s optimistic tag list)
  // would carry the last note's into this one. The key is what makes "a different
  // note is a different control" true again.
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
    />
  );
}

/**
 * Not a 404. The reader used to throw one, which was right when the URL was
 * answered by a query — the row was missing from the database and nothing else
 * could be said. Now the URL is answered by a payload the tree is rendering
 * from at the same moment, so the honest reading is "not in this vault": a
 * stale tab, a shared link to something since trashed, a typed path. The tree
 * is still there beside it, which is the fastest way out.
 */
function Gone() {
  return (
    <div className="nt-blank">
      <h1 className="nt-blank-h">Not in the vault</h1>
      <p className="nt-blank-p">
        Nothing here answers to that address. It may have been trashed, or renamed out from under
        the link — the tree on the left is the shortest way to whatever took its place.
      </p>
      <div className="nt-blank-row">
        {/* The way back into a vault already in memory should not cost a round
            trip; the trash is a different room and genuinely does. The two sit
            side by side here, which is the one place the distinction is visible
            in a single line of markup. */}
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
