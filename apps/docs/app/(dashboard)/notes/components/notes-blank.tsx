import { NewNoteButtons } from "./new-note-buttons";

/**
 * /notes with nothing selected. It gets a sentence about what the vault is for
 * rather than "no note selected", because the state it most often appears in is
 * an empty database — and at that moment the useful thing to say is what the
 * two buttons underneath will build.
 */
export function NotesBlank() {
  return (
    <div className="nt-blank">
      <h1 className="nt-blank-h">Start your first note</h1>
      <p className="nt-blank-p">
        Somewhere to answer the questions you keep re-answering. Folders nest as deep as you like,
        questions sit at the ends of the branches, and tags cut across all of it.
      </p>
      <div className="nt-blank-row">
        <NewNoteButtons parentId={null} />
      </div>
    </div>
  );
}
