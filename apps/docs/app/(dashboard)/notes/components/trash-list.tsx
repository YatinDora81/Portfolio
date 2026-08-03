"use client";

import { useState, useTransition } from "react";
import { IconAlertTriangle, IconFileText, IconFolder } from "@tabler/icons-react";
import { Dialog } from "@/components/ui/dialog";
import { emptyTrash, purgeNode, restoreNode } from "@/lib/actions/notes";
import type { TrashRow } from "@/lib/notes/view-types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The reader's stamp shape ("Aug 3, 2026"), read straight off the ISO string
 * rather than through `Date`.
 *
 * `revisedStamp` in answer-view.tsx can call `toLocaleDateString` because it
 * runs on the server and only ever runs there. This list is server-rendered and
 * then hydrated, and both a locale format and a relative time read the timezone
 * of whichever side is running — so around midnight UTC the two renders
 * disagree and every row is a hydration mismatch. The cost is that the date is
 * UTC, which for "when did I delete this" is close enough.
 */
function stamp(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${Number(d)}, ${y}`;
}

/** What a confirm is standing in front of. */
type Ask = { row: TrashRow } | { all: true } | null;

export function TrashList({ rows }: { rows: TrashRow[] }) {
  const [ask, setAsk] = useState<Ask>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Nothing is mirrored locally. Every action here revalidates /notes, so the
  // list that comes back with the transition is the answer, and there is no
  // optimistic copy to reconcile against it — unlike the revise deck, where a
  // wait between cards is the thing worth avoiding.
  const run = (work: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await work().catch(
        () => ({ ok: false, error: "The change never reached the server" }) as const,
      );
      setAsk(null);
      if (!r.ok) setError(r.error);
    });
  };

  const alert =
    error === null ? null : (
      <div className="nt-live" role="alert">
        <span>{error}</span>
        <button type="button" className="btn ghost" onClick={() => setError(null)}>
          Dismiss
        </button>
      </div>
    );

  if (!rows.length) {
    return (
      <>
        <div className="nt-empty">
          Nothing in the trash. A note you delete waits here with everything that was inside it, and
          only leaves when you say so.
        </div>
        {alert}
      </>
    );
  }

  return (
    <>
      <div className="nt-list">
        {rows.map((r) => (
          <div key={r.id} className="nt-litem">
            <span className="nt-lic" aria-hidden="true">
              {r.kind === "FOLDER" ? <IconFolder size={15} stroke={1.6} /> : <IconFileText size={15} stroke={1.6} />}
            </span>
            <span className="nt-lt">
              <span className="sr-only">{r.kind === "FOLDER" ? "Folder: " : "Question: "}</span>
              {r.title}
            </span>
            <span className="nt-lm">
              returns to {r.homePath} · {r.inside ? `${r.inside} inside · ` : ""}trashed{" "}
              {stamp(r.deletedAt)}
            </span>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => run(() => restoreNode(r.id))}
            >
              Restore
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={pending}
              onClick={() => setAsk({ row: r })}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="nt-acts">
        <button type="button" className="btn danger" disabled={pending} onClick={() => setAsk({ all: true })}>
          Empty trash
        </button>
        <span className="nt-stamp">
          {rows.length} item{rows.length === 1 ? "" : "s"} · restoring is free, deleting is not
        </span>
      </div>

      {/* The admin's own confirm, for the reason `DeleteButton` states next to
          it: a confirm's job is to stand in front of something the undo cannot
          reach, and purging is the one gesture in this feature with no undo
          behind it. Restore has none, because trashing again is the undo. */}
      <Dialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        icon={IconAlertTriangle}
        title={ask && "row" in ask ? `Delete “${ask.row.title}” permanently?` : "Empty the trash?"}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setAsk(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={pending}
              onClick={() =>
                run(() => (ask && "row" in ask ? purgeNode(ask.row.id) : emptyTrash()))
              }
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </button>
          </>
        }
      >
        <p>
          {ask && "row" in ask
            ? `“${ask.row.title}”${ask.row.inside ? ` and the ${ask.row.inside} row${ask.row.inside === 1 ? "" : "s"} inside it` : ""} leave${ask.row.inside ? "" : "s"} the database for good. This is the trash, so there is nowhere further back.`
            : `All ${rows.length} trashed item${rows.length === 1 ? "" : "s"}, and everything inside them, leave the database for good. There is nowhere further back.`}
        </p>
      </Dialog>

      {alert}
    </>
  );
}
