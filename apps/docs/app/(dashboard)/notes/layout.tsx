import { loadVault } from "@/lib/notes/vault";
import { NoteTree } from "./components/note-tree";
import { NotesMobileBar, TreeDrawerProvider, TreeVeil } from "./components/tree-drawer";
import { NotePaneShell, VaultProvider } from "./components/vault-provider";

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const payload = await loadVault();

  return (
    <VaultProvider payload={payload}>
      <TreeDrawerProvider>
        <div className="nt">
          <TreeVeil />
          <NoteTree />
          <div className="nt-col">
            <NotesMobileBar />
            <NotePaneShell>{children}</NotePaneShell>
          </div>
        </div>
      </TreeDrawerProvider>
    </VaultProvider>
  );
}
