"use client";

import { IconFileText, IconFolder } from "@tabler/icons-react";
import { rootRowsIn, rootStatsIn } from "@/lib/notes/vault-view";
import { ExportMenu } from "./export-menu";
import { ImportButton } from "./import-dialog";
import { NewNoteButtons } from "./new-note-buttons";
import { NoteLink, useVault } from "./vault-provider";

export function VaultRoot() {
  const ix = useVault();
  const rows = rootRowsIn(ix);
  const stats = rootStatsIn(ix);

  return (
    <article>
      <h1 className="nt-title">The vault</h1>

      <div className="nt-stat">
        <div>
          <div className="nt-sv">{stats.questions}</div>
          <div className="nt-sl">questions</div>
        </div>
        <div>
          <div className="nt-sv">{stats.folders}</div>
          <div className="nt-sl">folders</div>
        </div>
        <div>
          <div className="nt-sv">{stats.solidPct}%</div>
          <div className="nt-sl">solid</div>
        </div>
      </div>

      <div className="nt-acts">
        <NewNoteButtons parentId={null} />
        <ImportButton parentId={null} canRestore={ix.vaultEmpty} />
        <ExportMenu nodeId={null} kind="VAULT" title="the whole vault" />
        <span className="nt-stamp">top level · {rows.length} row{rows.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length ? (
        <div className="nt-list">
          {rows.map((row) => (
            <NoteLink className="nt-litem" key={row.id} href={row.href}>
              <span className="nt-lic" aria-hidden>
                {row.kind === "FOLDER"
                  ? <IconFolder size={15} stroke={1.6} />
                  : <IconFileText size={15} stroke={1.6} />}
              </span>
              <span className="nt-lt">{row.title}</span>
              <span className="nt-lm">{row.meta}</span>
            </NoteLink>
          ))}
        </div>
      ) : (
        <p className="nt-empty">
          Nothing at the top level. Everything is nested, which is fine — the tree is the way in.
        </p>
      )}
    </article>
  );
}
