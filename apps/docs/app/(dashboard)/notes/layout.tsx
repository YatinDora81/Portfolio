import { loadVault } from "@/lib/notes/vault";
import { NoteTree } from "./components/note-tree";
import { NotePaneShell, VaultProvider } from "./components/vault-provider";

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
