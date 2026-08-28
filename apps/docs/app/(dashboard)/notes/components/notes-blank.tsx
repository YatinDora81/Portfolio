import { ImportButton } from "./import-dialog";
import { NewNoteButtons } from "./new-note-buttons";

export function NotesBlank({ vaultEmpty = false }: { vaultEmpty?: boolean }) {
  return (
    <div className="nt-blank">
      <h1 className="nt-blank-h">Start your first note</h1>
      <p className="nt-blank-p">
        Somewhere to answer the questions you keep re-answering. Folders nest as deep as you like,
        questions sit at the ends of the branches, and tags cut across all of it.
      </p>
      <div className="nt-blank-row">
        <NewNoteButtons parentId={null} />

        <ImportButton parentId={null} canRestore={vaultEmpty} />
      </div>
    </div>
  );
}
