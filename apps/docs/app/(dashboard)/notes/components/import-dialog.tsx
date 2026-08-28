"use client";

import { useDeferredValue, useMemo, useState, useTransition, type ReactNode } from "react";
import { IconAlertTriangle, IconFileImport, IconFileText, IconFolder, IconUpload } from "@tabler/icons-react";
import { Dialog } from "@/components/ui/dialog";
import { importVault } from "@/lib/actions/notes";
import {
  MAX_DEPTH,
  MAX_JSON_BYTES,
  SHAPE_LABEL,
  fileRoots,
  parseImport,
  planGraft,
  summarise,
  topoOrder,
  type FolderMode,
  type ImportMode,
  type Shape,
  type VaultNode,
} from "@/lib/notes/import";
import { buildTree, type TreeNode } from "@/lib/notes/paths";
import { CONF_LABELS } from "@/lib/notes/query";
import { hrefFor } from "@/lib/notes/view-types";
import { useNoteNav, useVault } from "./vault-provider";

const PREVIEW_ROWS = 150;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function rootNoun(roots: VaultNode[]): string {
  const folders = roots.filter((r) => r.kind === "FOLDER").length;
  if (folders === roots.length) return plural(roots.length, "folder");
  if (folders === 0) return plural(roots.length, "question");
  return plural(roots.length, "note");
}

const EXAMPLE = `[
  { "title": "DSA", "children": [
      { "title": "Graphs", "children": [
          {
            "title": "Dijkstra vs Bellman-Ford",
            "body": "Dijkstra assumes non-negative weights.",
            "tags": ["graphs", "shortest-path"],
            "confidence": "good"
          },
          "When is BFS enough for shortest path?"
      ]},
      { "title": "Dynamic Programming", "children": [] }
  ]}
]`;

const BLOCKS_EXAMPLE = `{
  "title": "Which of these is O(log n)?",
  "body": "::: quiz\\n- Linear search\\n+ Binary search\\n= It halves the range each step.\\n:::\\n\\n::: note Remember\\nThe input has to be sorted.\\n:::"
}`;

type Preview =
  | { ok: true; shape: Shape; nodes: VaultNode[]; stats: ReturnType<typeof summarise> }
  | { ok: false; error: string }
  | null;

function PreviewTree({ nodes }: { nodes: VaultNode[] }) {
  const roots = useMemo(
    () =>
      buildTree(
        topoOrder(nodes).map((n, i) => ({
          id: n.id,
          parentId: n.parentId,
          kind: n.kind,
          title: n.title,
          slug: "",
          path: "",
          depth: 0,
          sortOrder: i,
        })),
      ),
    [nodes],
  );

  let left = PREVIEW_ROWS;
  const render = (list: TreeNode[]): ReactNode =>
    list.map((n) => {
      if (left <= 0) return null;
      left--;
      return (
        <div className="nt-item" key={n.id}>
          <div className="nt-row">
            <span className="nt-ic" aria-hidden>
              {n.kind === "FOLDER" ? <IconFolder size={14} stroke={1.6} /> : <IconFileText size={14} stroke={1.6} />}
            </span>
            <span className="nt-tx">{n.title}</span>
          </div>
          {n.children.length ? <div className="nt-group">{render(n.children)}</div> : null}
        </div>
      );
    });

  const rows = render(roots);
  const hidden = nodes.length - PREVIEW_ROWS;

  return (
    <div className="nt-imp-prev">
      {rows}
      {hidden > 0 ? <div className="nt-imp-more">…and {plural(hidden, "more note")}</div> : null}
    </div>
  );
}

function Instructions({ onUseExample }: { onUseExample: () => void }) {
  return (
    <details className="nt-imp-help">
      <summary>What can I paste?</summary>

      <p className="nt-imp-p">
        <b>An outline you wrote.</b> Structure is containment: anything with <code>children</code> is a folder,
        everything else is a question. Nothing is required but a title.
      </p>
      <pre className="nt-imp-code">{EXAMPLE}</pre>
      <ul className="nt-imp-ul">
        <li>
          A plain string — <code>&quot;When is BFS enough?&quot;</code> — is a question with no answer yet.
        </li>
        <li>
          <code>&quot;children&quot;: []</code> is how you say <i>empty folder</i>. Leave <code>children</code> out
          entirely and it is a question instead.
        </li>
        <li>
          <code>tags</code> takes <code>[&quot;a&quot;, &quot;b&quot;]</code> or <code>&quot;a, b&quot;</code>.
          They are lowercased and de-duplicated on the way in.
        </li>
        <li>
          <code>confidence</code> takes {CONF_LABELS.join(" · ")}, or 0–4. Anything else reads as unrated.
        </li>
        <li>
          <code>body</code> is markdown, and belongs to questions — a folder carrying one is refused rather than
          silently dropped.
        </li>
        <li>Order is kept, and folders may nest up to {MAX_DEPTH} deep.</li>
      </ul>

      <p className="nt-imp-p">
        <b>Bodies can hold more than prose.</b> A body is markdown, so it can carry a clickable multiple-choice
        question, a foldaway section, or a callout — newlines and all, escaped as <code>\n</code> the way JSON
        wants them.
      </p>
      <pre className="nt-imp-code">{BLOCKS_EXAMPLE}</pre>
      <ul className="nt-imp-ul">
        <li>
          In a <code>::: quiz</code>, <code>+</code> marks a correct choice and <code>-</code> a wrong one; two
          correct choices turn it into checkboxes. <code>=</code> is the reason, revealed with the answer.
        </li>
        <li>
          <code>::: details Title</code> folds anything away, containers included. <code>::: note</code>,{" "}
          <code>::: tip</code> and <code>::: warn</code> are the three callouts. Close each one with{" "}
          <code>:::</code>.
        </li>
      </ul>

      <p className="nt-imp-p">
        <b>Or a vault export.</b> The JSON from any Export button goes straight back in — bodies, tags, confidence
        and revision dates included. Ids are reissued so it can land beside the original rather than on top of it.
      </p>

      <button type="button" className="btn ghost nt-imp-try" onClick={onUseExample}>
        <IconFileImport size={14} stroke={1.7} />
        Put the example in the box
      </button>
    </details>
  );
}

export function ImportButton({
  parentId,
  parentTitle,
  canRestore = false,
  variant = "btn",
}: {
  parentId: string | null;
  parentTitle?: string;
  canRestore?: boolean;
  variant?: "btn" | "pri" | "icon";
}) {
  const go = useNoteNav();
  const { rows } = useVault();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ImportMode>("into");
  const [folders, setFolders] = useState<FolderMode>("merge");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deferred = useDeferredValue(text);

  const preview: Preview = useMemo(() => {
    const t = deferred.trim();
    if (!t) return null;
    // blob measures bytes; t.length counts utf-16 units
    if (new Blob([t]).size > MAX_JSON_BYTES) return { ok: false, error: "That file is too large to import" };
    let raw: unknown;
    try {
      raw = JSON.parse(t);
    } catch {
      return { ok: false, error: "That isn't valid JSON" };
    }
    const parsed = parseImport(raw);
    return parsed.ok ? { ...parsed, stats: summarise(parsed.nodes) } : parsed;
  }, [deferred]);

  const restorable = canRestore && preview?.ok === true && preview.shape === "vault";
  const effective: ImportMode = restorable && mode === "restore" ? "restore" : "into";
  const effectiveFolders: FolderMode = effective === "into" ? folders : "create";

  const plan = useMemo(
    () => (preview?.ok ? planGraft(preview.nodes, parentId, rows, effectiveFolders) : null),
    [preview, parentId, rows, effectiveFolders],
  );

  const madeRoots = useMemo(
    () => (preview?.ok && plan ? fileRoots(preview.nodes).filter((r) => !plan.merged.has(r.id)) : []),
    [preview, plan],
  );

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // cleared so picking the same file again fires change
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_JSON_BYTES) {
      setError("That file is too large to import");
      return;
    }
    setText(await file.text());
  };

  const run = () =>
    start(async () => {
      setError(null);
      const r = await importVault(parentId, text, effective, effectiveFolders).catch(
        () => ({ ok: false, error: "The import never reached the server" }) as const,
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setText("");
      setOpen(false);
      go(hrefFor(r.path), { afterWrite: true });
    });

  const count = preview?.ok ? preview.nodes.length : 0;

  const what = parentTitle ? `Paste notes into “${parentTitle}”` : "Paste notes into the vault root";

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          className="nt-iconbtn"
          title={what}
          aria-label={what}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <IconUpload size={15} stroke={1.7} />
        </button>
      ) : (
        <button
          type="button"
          className={variant === "pri" ? "btn pri" : "btn"}
          title={what}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <IconUpload size={13} stroke={1.7} />
          Import
        </button>
      )}

      <Dialog
        open={open}
        onClose={close}
        wide
        icon={IconFileImport}
        title="Import notes"
        footer={
          <>
            <button type="button" className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn pri" disabled={pending || !preview?.ok} onClick={run}>
              {pending ? "Importing…" : preview?.ok ? `Import ${plural(count, "note")}` : "Import"}
            </button>
          </>
        }
      >
        <div className="nt-imp-dest">
          Into
          <span className="chip">
            <IconFolder size={11} stroke={1.7} />
            {parentTitle ?? "the vault root"}
          </span>
        </div>

        <Instructions onUseExample={() => setText(EXAMPLE)} />

        <div className="nt-field">
          <label className="nt-lb" htmlFor="nt-imp-json">
            JSON
          </label>
          <textarea
            id="nt-imp-json"
            className="nt-ta"
            rows={12}
            spellCheck={false}
            value={text}
            placeholder="Paste a vault export, or an outline of your own"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="nt-imp-file">
            <label className="btn">
              <IconUpload size={13} stroke={1.7} />
              Choose a file
              <input type="file" accept="application/json,.json" hidden onChange={onFile} />
            </label>
            {text ? (
              <button type="button" className="btn ghost" onClick={() => setText("")}>
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {preview ? (
          preview.ok ? (
            <>
              <div className="nt-imp-sum" role="status">
                <span className="chip amb">{SHAPE_LABEL[preview.shape]}</span>
                <span className="chip">{plural(preview.stats.folders, "folder")}</span>
                <span className="chip">{plural(preview.stats.questions, "question")}</span>
                <span className="chip">{preview.stats.roots} top-level</span>
                <span className="chip">{plural(preview.stats.maxDepth, "level")} deep</span>
                {preview.stats.tags.length ? (
                  <span className="chip">{plural(preview.stats.tags.length, "tag")}</span>
                ) : null}
              </div>
              <PreviewTree nodes={preview.nodes} />
            </>
          ) : (
            <p className="nt-hint nt-bad" role="status">
              {preview.error}
            </p>
          )
        ) : null}

        {canRestore ? (
          <div className="nt-imp-modes">
            <label className="nt-imp-mode">
              <input
                type="radio"
                name="nt-imp-mode"
                checked={effective === "into"}
                onChange={() => setMode("into")}
              />
              <span>
                <b>Import</b> — every note is given a fresh id, so it can never collide with what is already here.
              </span>
            </label>
            <label className={restorable ? "nt-imp-mode" : "nt-imp-mode off"}>
              <input
                type="radio"
                name="nt-imp-mode"
                disabled={!restorable}
                checked={effective === "restore"}
                onChange={() => setMode("restore")}
              />
              <span>
                <b>Restore</b> — keep the file&apos;s own ids, so the vault comes back exactly as it was exported.
                {restorable ? null : " Needs a vault export, not an outline."}
              </span>
            </label>
          </div>
        ) : null}

        {effective === "into" ? (
          <div className="nt-imp-modes">
            <label className="nt-imp-mode">
              <input
                type="radio"
                name="nt-imp-folders"
                checked={folders === "merge"}
                onChange={() => setFolders("merge")}
              />
              <span>
                <b>Use existing folders</b> — a folder already here by that name is opened and added to, as
                far down as the names keep matching.
              </span>
            </label>
            <label className="nt-imp-mode">
              <input
                type="radio"
                name="nt-imp-folders"
                checked={folders === "create"}
                onChange={() => setFolders("create")}
              />
              <span>
                <b>Always make new ones</b> — the file lands whole and separate, beside anything that shares
                its name.
              </span>
            </label>
          </div>
        ) : null}

        {/* shown even when nothing merges */}
        {plan && effective === "into" ? (
          <p className="nt-hint">
            {folders === "merge" ? (
              <>
                {plan.foldersReused} existing folder{plan.foldersReused === 1 ? "" : "s"} reused,{" "}
                {plan.foldersCreated} new
              </>
            ) : (
              <>
                {plan.foldersCreated} folder{plan.foldersCreated === 1 ? "" : "s"} created
              </>
            )}
            {" · "}
            {plan.questionsCreated} note{plan.questionsCreated === 1 ? "" : "s"} added
          </p>
        ) : null}

        <p className="nt-imp-warn">
          <IconAlertTriangle size={14} stroke={1.7} />
          <span>
            An import is not staged and there is no undo —{" "}
            {!preview?.ok ? (
              <>if it is wrong, the way back is to trash the notes it just made.</>
            ) : madeRoots.length ? (
              <>if it is wrong, the way back is to trash the {rootNoun(madeRoots)} it just made.</>
            ) : (
              <>
                and every note in this file lands inside folders you already have, so there is nothing new at
                the top to trash if it is wrong.
              </>
            )}
          </span>
        </p>

        {error ? (
          <p className="nt-hint nt-bad" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
