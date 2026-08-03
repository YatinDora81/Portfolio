import { loadTree } from "@/lib/notes/load";
import { NoteTree } from "./components/note-tree";

/**
 * The tree lives in the layout, not in the page.
 *
 * Next re-renders only what changed below a shared layout, so navigating from
 * one note to the next repaints the right-hand pane and leaves the tree alone.
 * Its scroll position, its expanded folders and its keyboard focus all survive
 * the navigation without a client-side cache, a store, or a single line of
 * persistence code.
 */
export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const { tree, trashCount, vaultEmpty } = await loadTree();

  return (
    <div className="nt">
      <NoteTree tree={tree} trashCount={trashCount} vaultEmpty={vaultEmpty} />
      <div className="nt-pane">{children}</div>
    </div>
  );
}
