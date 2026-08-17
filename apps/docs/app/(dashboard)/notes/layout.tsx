import { loadVault } from "@/lib/notes/vault";
import { NoteTree } from "./components/note-tree";
import { NotePaneShell, VaultProvider } from "./components/vault-provider";

/**
 * The whole vault is loaded here, once, and nothing under /notes reads the
 * database again.
 *
 * Next re-renders only what changed below a shared layout, so this survives
 * every navigation inside the section — and because the payload carries the
 * answer bodies with it, moving between notes has nothing left to fetch. The
 * tree's scroll position, its expanded folders and its keyboard focus survive
 * for the same reason they always did, without a client-side cache, a store, or
 * a line of persistence code.
 *
 * The measurement behind the decision to ship all of it: 436 live rows and
 * 247k characters of prose come to ~420 KB of JSON, once, against ~90ms per
 * round trip to Neon and three or four of them per note opened the old way.
 */
export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const payload = await loadVault();

  return (
    <VaultProvider payload={payload}>
      <div className="nt">
        <NoteTree />
        <NotePaneShell>{children}</NotePaneShell>
      </div>
    </VaultProvider>
  );
}
