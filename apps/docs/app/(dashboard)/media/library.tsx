"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALT_ISSUE_LABEL,
  MIN_ALT_LENGTH,
  altTextIssue,
  folderOfKey,
  formatBytes,
  sanitizeFolder,
  type AltIssue,
  type MediaAssetDto,
} from "@repo/storage/media";
import { Button } from "@/components/ui/button";
import { Card, CardHead } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { cdnUrl } from "@/lib/utils";
import { deleteAsset, updateAltText } from "@/lib/actions/media";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDatabase,
  IconExternalLink,
  IconEyeOff,
  IconPhoto,
  IconPlugConnectedX,
  IconSearch,
  IconTrash,
  IconUnlink,
} from "@tabler/icons-react";
import { MediaBrowser, type BucketChange } from "./browser";
import { Uploader, type UploaderHandle } from "./uploader";

export interface MediaRow extends MediaAssetDto {
  createdLabel: string;
  usedIn: string[];
}

type View = "files" | "all" | "alt" | "orphans";

interface Blocked {
  key: string;
  usedIn: string[];
}

function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function issueOf(row: MediaRow): AltIssue | null {
  return altTextIssue(row.altText);
}

function relocate(url: string, from: string, to: string): string {
  return url.endsWith(from) ? `${url.slice(0, url.length - from.length)}${to}` : url;
}

function emptyTitle(view: View, total: number, audited: number, orphans: number): string {
  if (total === 0) return "Nothing uploaded yet";
  if (view === "alt" && audited === 0) return "Every image is described";
  if (view === "orphans" && orphans === 0) return "Everything is referenced";
  return "Nothing matches";
}

function emptyBody(view: View, total: number, audited: number, orphans: number): string {
  if (total === 0) return "Images dropped above land here once they have alt text.";
  if (view === "alt" && audited === 0) {
    return "No empty, placeholder or one-word alt text anywhere in the library.";
  }
  if (view === "orphans" && orphans === 0) {
    return "Every asset was found in a project, a blog, an experience or a site setting.";
  }
  return "Try a different search, folder or view.";
}

export function MediaLibrary({
  rows: initial,
  storage,
  scanned,
  initialPrefix,
}: {
  rows: MediaRow[];
  storage: { configured: boolean; missing: string[] };
  scanned: number;
  initialPrefix: string;
}) {
  const [rows, setRows] = useState<MediaRow[]>(initial);
  const [view, setView] = useState<View>("files");
  const [folder, setFolder] = useState<string>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploadFolder, setUploadFolder] = useState("uploads");
  const [auditIds, setAuditIds] = useState<ReadonlySet<string>>(new Set());
  const [bucketPrefix, setBucketPrefix] = useState(initialPrefix);
  const [reloadKey, setReloadKey] = useState(0);
  const uploader = useRef<UploaderHandle>(null);
  const settle = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current);
    },
    [],
  );

  const folders = useMemo(
    () => [...new Set(rows.map((r) => r.folder))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const flagged = useMemo(() => rows.filter((r) => issueOf(r) !== null), [rows]);
  const orphans = useMemo(() => rows.filter((r) => r.usedIn.length === 0), [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base =
      view === "alt"
        ? rows.filter((r) => auditIds.has(r.id))
        : view === "orphans"
          ? orphans
          : rows;
    return base.filter((r) => {
      if (folder !== "all" && r.folder !== folder) return false;
      if (needle === "") return true;
      return (
        r.filename.toLowerCase().includes(needle) ||
        r.altText.toLowerCase().includes(needle) ||
        r.key.toLowerCase().includes(needle)
      );
    });
  }, [auditIds, folder, orphans, q, rows, view]);

  const showAudit = () => {
    setAuditIds(new Set(flagged.map((r) => r.id)));
    setView("alt");
  };

  const open = rows.find((r) => r.id === openId) ?? null;
  const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);

  const onSaved = (asset: MediaAssetDto) => {
    const row: MediaRow = { ...asset, createdLabel: "just now", usedIn: [] };
    setRows((prev) => [row, ...prev.filter((r) => r.id !== asset.id)]);
  };

  const onAltSaved = (id: string, altText: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, altText } : r)));
  };

  const onDeleted = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setOpenId(null);
  };

  const rereadBucket = () => {
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setReloadKey((n) => n + 1), 700);
  };

  const onBucketChange = (change: BucketChange) => {
    setRows((prev) => {
      let next = prev;
      if (change.removed && change.removed.length > 0) {
        const gone = new Set(change.removed);
        next = next.filter((r) => !gone.has(r.key));
      }
      if (change.moved && change.moved.length > 0) {
        const moves = new Map(change.moved.map((m) => [m.from, m.to] as const));
        next = next.map((r) => {
          const to = moves.get(r.key);
          if (to === undefined) return r;
          return { ...r, key: to, url: relocate(r.url, r.key, to), folder: folderOfKey(to) };
        });
      }
      if (change.altered && change.altered.length > 0) {
        const described = new Map(change.altered.map((a) => [a.key, a.altText] as const));
        next = next.map((r) => ({ ...r, altText: described.get(r.key) ?? r.altText }));
      }
      if (change.renamed && change.renamed.length > 0) {
        const named = new Map(change.renamed.map((n) => [n.id, n.filename] as const));
        next = next.map((r) => ({ ...r, filename: named.get(r.id) ?? r.filename }));
      }
      if (change.upserted && change.upserted.length > 0) {
        const ids = new Set(change.upserted.map((a) => a.id));
        const adopted = change.upserted.map((asset) => {
          const had = next.find((r) => r.key === asset.key);
          return {
            ...asset,
            createdLabel: had?.createdLabel ?? "just now",
            usedIn: had?.usedIn ?? [],
          };
        });
        next = [...adopted, ...next.filter((r) => !ids.has(r.id))];
      }
      return next;
    });
  };

  return (
    <>
      {!storage.configured ? (
        <div className="rv-banner bad">
          <i>
            <IconPlugConnectedX size={17} stroke={1.7} />
          </i>
          <div>
            <b>Object storage is not configured</b>
            {storage.missing.join(", ")} {storage.missing.length === 1 ? "is" : "are"} unset, so no
            upload can be signed. Everything already in the library still lists, opens, and can have
            its alt text fixed — only signing and deleting need the credentials. Set them in{" "}
            <code>apps/docs/.env</code> (see <code>.env.example</code>) and restart.
          </div>
        </div>
      ) : null}

      <div className="stat-grid even">
        <div className="stat">
          <div className="stat-k">
            <IconPhoto size={11} /> library rows
          </div>
          <div className="stat-v">{rows.length}</div>
          <div className="stat-m">{formatBytes(totalBytes)} tracked · the bucket may hold more</div>
        </div>
        <div className="stat">
          <div className="stat-k">
            <IconEyeOff size={11} /> weak alt text
          </div>
          <div className="stat-v">{flagged.length}</div>
          <div className="stat-m">
            {flagged.length === 0 ? <em>every image is described</em> : <i>needs a real sentence</i>}
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">
            <IconUnlink size={11} /> unused
          </div>
          <div className="stat-v">{orphans.length}</div>
          <div className="stat-m">library-wide, nothing found pointing at them</div>
        </div>
        <div className="stat">
          <div className="stat-k">
            <IconDatabase size={11} /> fields scanned
          </div>
          <div className="stat-v">{scanned}</div>
          <div className="stat-m">projects, blogs, experience, site settings</div>
        </div>
      </div>

      <Card className="md-upcard">
        <CardHead title="Upload" />
        <div className="card-b">
          <Uploader
            ref={uploader}
            prefix={`${sanitizeFolder(uploadFolder)}/`}
            folder={uploadFolder}
            onFolderChange={setUploadFolder}
            configured={storage.configured}
            missing={storage.missing}
            onSaved={onSaved}
            onLanded={rereadBucket}
            onDiscarded={rereadBucket}
          />
        </div>
      </Card>

      <Card flush className="md-card">
        <div className="md-bar">
          <div className="md-tabs">
            <button
              className={`filt${view === "files" ? " on" : ""}`}
              onClick={() => setView("files")}
            >
              files
            </button>
            <button className={`filt${view === "all" ? " on" : ""}`} onClick={() => setView("all")}>
              library · {rows.length}
            </button>
            <button className={`filt${view === "alt" ? " on" : ""}`} onClick={showAudit}>
              missing alt · {flagged.length}
            </button>
            <button
              className={`filt${view === "orphans" ? " on" : ""}`}
              onClick={() => setView("orphans")}
            >
              unused · {orphans.length}
            </button>
          </div>
          <span className="sp" />
          {view === "files" ? null : (
            <div className="md-search">
              <IconSearch size={14} stroke={1.7} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="filename, alt text or key"
                aria-label="Search the library"
              />
            </div>
          )}
        </div>

        {folders.length > 1 && view !== "files" ? (
          <div className="filters">
            <button
              className={`filt${folder === "all" ? " on" : ""}`}
              onClick={() => setFolder("all")}
            >
              all folders
            </button>
            {folders.map((f) => (
              <button
                key={f}
                className={`filt${folder === f ? " on" : ""}`}
                onClick={() => setFolder(f)}
              >
                {f} · {rows.filter((r) => r.folder === f).length}
              </button>
            ))}
          </div>
        ) : null}

        {view === "orphans" ? (
          <div className="md-note">
            <IconAlertTriangle size={14} stroke={1.7} />
            <span>
              Flagged, never swept. This scan reads the fields that hold a path — it cannot see an
              image referenced from somewhere it does not know to look, so treat the list as
              &ldquo;check these&rdquo; and delete one only when you have looked.
            </span>
          </div>
        ) : null}

        {view === "files" ? (
          <MediaBrowser
            initialPrefix={bucketPrefix}
            storage={storage}
            reloadKey={reloadKey}
            onNavigate={(next) => {
              setBucketPrefix(next);
              setUploadFolder(next === "" ? "" : next.slice(0, -1));
            }}
            onEnqueue={(files, root) => uploader.current?.enqueueDropped(files, root)}
            onPickFiles={(root) => uploader.current?.pickFiles(root)}
            onPickFolder={(root) => uploader.current?.pickFolder(root)}
            onLibraryChanged={onBucketChange}
          />
        ) : visible.length === 0 ? (
          <div className="empty">
            <div className="empty-ic">
              <IconPhoto size={18} stroke={1.5} />
            </div>
            <b>{emptyTitle(view, rows.length, auditIds.size, orphans.length)}</b>
            <span>{emptyBody(view, rows.length, auditIds.size, orphans.length)}</span>
          </div>
        ) : view === "alt" ? (
          <div className="rows">
            {visible.map((row) => (
              <AuditRow key={row.id} row={row} onSaved={onAltSaved} />
            ))}
          </div>
        ) : (
          <div className="md-grid">
            {visible.map((row) => (
              <Tile key={row.id} row={row} onOpen={() => setOpenId(row.id)} />
            ))}
          </div>
        )}
      </Card>

      {open ? (
        <Detail
          key={open.id}
          row={open}
          canDelete={storage.configured}
          onClose={() => setOpenId(null)}
          onAltSaved={onAltSaved}
          onDeleted={onDeleted}
        />
      ) : null}
    </>
  );
}

function Tile({ row, onOpen }: { row: MediaRow; onOpen: () => void }) {
  const issue = issueOf(row);
  return (
    <button className="md-cell" onClick={onOpen}>
      <span
        className="md-thumb"
        style={
          row.blurDataUrl
            ? { backgroundImage: `url(${row.blurDataUrl})`, backgroundSize: "cover" }
            : undefined
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cdnUrl(row.url)} alt="" loading="lazy" />
      </span>
      <span className="md-cell-b">
        <span className="md-name">{row.filename}</span>
        <span className="md-meta">
          {row.width && row.height ? `${row.width}×${row.height}` : "size unknown"} ·{" "}
          {formatBytes(row.bytes)} · {row.createdLabel}
        </span>
        <span className="md-alt">{row.altText}</span>
        <span className="md-flags">
          <span className="chip off">{row.folder}</span>
          {issue ? <span className="chip amb">{ALT_ISSUE_LABEL[issue]}</span> : null}
          {row.usedIn.length === 0 ? <span className="chip amb">unused</span> : null}
        </span>
      </span>
    </button>
  );
}

function AuditRow({
  row,
  onSaved,
}: {
  row: MediaRow;
  onSaved: (id: string, altText: string) => void;
}) {
  const [value, setValue] = useState(row.altText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const issue = issueOf(row);
  const trimmed = value.trim();
  const dirty = trimmed !== row.altText.trim();
  const canSave = dirty && trimmed.length >= MIN_ALT_LENGTH && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateAltText({ id: row.id, altText: value });
      if (!res.ok || !res.altText) {
        setError(res.error ?? "That alt text was not saved.");
        return;
      }
      onSaved(row.id, res.altText);
      setDone(true);
    } catch (e) {
      setError(transportError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row md-audit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="md-audit-thumb" src={cdnUrl(row.url)} alt="" loading="lazy" />
      <div className="row-main">
        <div className="md-audit-top">
          <span className="row-t mono">{row.filename}</span>
          {issue ? <span className="chip amb">{ALT_ISSUE_LABEL[issue]}</span> : null}
          {done && !issue ? (
            <span className="chip on">
              <IconCheck size={11} /> described
            </span>
          ) : null}
        </div>
        <div className="md-audit-edit">
          <input
            className="in"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDone(false);
            }}
            placeholder="Describe the image for someone who cannot see it"
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) void save();
            }}
          />
          <Button onClick={() => void save()} disabled={!canSave}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
        {error ? <div className="rv-err">{error}</div> : null}
      </div>
    </div>
  );
}

function Detail({
  row,
  canDelete,
  onClose,
  onAltSaved,
  onDeleted,
}: {
  row: MediaRow;
  canDelete: boolean;
  onClose: () => void;
  onAltSaved: (id: string, altText: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [value, setValue] = useState(row.altText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [blocked, setBlocked] = useState<Blocked[]>([]);

  const trimmed = value.trim();
  const dirty = trimmed !== row.altText.trim();
  const canSave = dirty && trimmed.length >= MIN_ALT_LENGTH && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateAltText({ id: row.id, altText: value });
      if (!res.ok || !res.altText) {
        setError(res.error ?? "That alt text was not saved.");
        return;
      }
      onAltSaved(row.id, res.altText);
      setSaved(true);
    } catch (e) {
      setError(transportError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (allowReferenced: boolean) => {
    setRemoving(true);
    setError(null);
    try {
      const res = await deleteAsset({
        id: row.id,
        ...(allowReferenced ? { allowReferenced: [row.key] } : {}),
      });
      if (!res.ok) {
        const still = res.blocked ?? [];
        setBlocked(still);
        if (still.length === 0) setConfirming(false);
        setError(res.error ?? "That asset was not deleted.");
        return;
      }
      onDeleted(row.id);
    } catch (e) {
      setError(transportError(e));
    } finally {
      setRemoving(false);
    }
  };

  const keep = () => {
    setBlocked([]);
    setConfirming(false);
    setError(null);
  };

  const breakages = blocked.reduce((sum, item) => sum + item.usedIn.length, 0);

  const copy = () => {
    void navigator.clipboard.writeText(row.url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={row.filename}
      icon={IconPhoto}
      wide
      footer={
        <>
          {saved ? (
            <span className="rv-ok md-det-saved">
              <IconCheck size={12} stroke={1.8} /> alt text saved
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={!canSave}>
            {busy ? "Saving…" : "Save alt text"}
          </Button>
        </>
      }
    >
      <div className="md-det">
        <div className="md-det-img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cdnUrl(row.url)} alt={row.altText} />
        </div>

        <dl className="md-det-facts">
          <div>
            <dt>dimensions</dt>
            <dd>{row.width && row.height ? `${row.width} × ${row.height}` : "not recorded"}</dd>
          </div>
          <div>
            <dt>size</dt>
            <dd>{formatBytes(row.bytes)}</dd>
          </div>
          <div>
            <dt>type</dt>
            <dd>{row.mimeType}</dd>
          </div>
          <div>
            <dt>folder</dt>
            <dd>{row.folder}</dd>
          </div>
          <div>
            <dt>uploaded</dt>
            <dd>{row.createdLabel}</dd>
          </div>
          <div>
            <dt>placeholder</dt>
            <dd>{row.blurDataUrl ? "stored" : "none"}</dd>
          </div>
        </dl>

        <div className="md-det-path">
          <code>{row.url}</code>
          <button className="ibtn" onClick={copy} aria-label="Copy the path">
            {copied ? <IconCheck size={13} stroke={1.8} /> : <IconCopy size={13} stroke={1.6} />}
          </button>
          <a className="ibtn" href={cdnUrl(row.url)} target="_blank" rel="noreferrer" aria-label="Open the file">
            <IconExternalLink size={13} stroke={1.6} />
          </a>
        </div>

        <div className="f">
          <label htmlFor={`alt-${row.id}`}>Alt text</label>
          <input
            id={`alt-${row.id}`}
            className="in"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            maxLength={500}
            placeholder="Describe the image for someone who cannot see it"
          />
          <div className="f-hint">
            {trimmed.length < MIN_ALT_LENGTH
              ? `At least ${MIN_ALT_LENGTH} characters — this is stored on a column that cannot be empty.`
              : (issueOf({ ...row, altText: value }) ?? null) !== null
                ? "This still reads like a label rather than a description."
                : "Reads like a description."}
          </div>
        </div>

        <div className="md-det-use">
          <div className="md-det-k">referenced by</div>
          {row.usedIn.length === 0 ? (
            <div className="md-det-none">
              Nothing found. The scan reads project logos and images, blog covers and bodies,
              experience logos and every site setting — an image reached some other way would look
              the same here, so check before deleting.
            </div>
          ) : (
            <ul className="md-det-list">
              {row.usedIn.map((where) => (
                <li key={where}>{where}</li>
              ))}
            </ul>
          )}
        </div>

        {error ? <div className="rv-err">{error}</div> : null}

        {blocked.length > 0 ? (
          <div className="md-det-use">
            <div className="md-det-k">still pointed at, read just now</div>
            <div className="mdb-blocked">
              {blocked.map((item) => (
                <div key={item.key}>
                  <b>{item.key}</b>
                  <span>{item.usedIn.join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="md-det-danger">
          {blocked.length > 0 ? (
            <>
              <span>
                Deleting anyway leaves{" "}
                {breakages === 1 ? "that place" : `those ${breakages} places`} pointing at a file
                that is no longer there. Fix the reference first if you can.
              </span>
              <Button variant="ghost" onClick={keep} disabled={removing}>
                Keep it
              </Button>
              <Button variant="destructive" onClick={() => void remove(true)} disabled={removing}>
                <IconTrash size={13} /> {removing ? "Deleting…" : "Delete anyway"}
              </Button>
            </>
          ) : confirming ? (
            <>
              <span>
                Delete the object and the row? There is no undo, and any page still pointing at it
                breaks.
              </span>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={removing}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void remove(false)} disabled={removing}>
                <IconTrash size={13} /> {removing ? "Deleting…" : "Yes, delete"}
              </Button>
            </>
          ) : (
            <>
              <span>
                {canDelete
                  ? "Removes the object from R2 and then the row."
                  : "Deleting needs the R2 credentials — without them the object cannot be removed."}
              </span>
              <Button variant="destructive" onClick={() => setConfirming(true)} disabled={!canDelete}>
                <IconTrash size={13} /> Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
