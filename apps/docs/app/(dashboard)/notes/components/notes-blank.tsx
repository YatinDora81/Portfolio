import { ImportButton } from "./import-dialog";
import { NewNoteButtons } from "./new-note-buttons";

/**
 * /notes with nothing selected. It gets a sentence about what the vault is for
 * rather than "no note selected", because the state it most often appears in is
 * an empty database — and at that moment the useful thing to say is what the
 * buttons underneath will build.
 *
 * Import sits here rather than only on a folder for the same reason: an empty
 * vault is exactly when somebody has a file to put in it, and the vault root is
 * the only destination that is not a folder you would first have to create.
 */
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
        {/* `canRestore` is the vault being genuinely empty, not this pane being
            empty — restore refuses anything else, and offering it here would be
            a button that always fails. */}
        <ImportButton parentId={null} canRestore={vaultEmpty} />
      </div>
    </div>
  );
}
