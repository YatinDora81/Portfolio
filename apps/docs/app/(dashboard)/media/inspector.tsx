"use client";

import { useState } from "react";
import {
  ALT_ISSUE_LABEL,
  MAX_UPLOAD_BYTES,
  MIN_ALT_LENGTH,
  altTextIssue,
  extensionOfKey,
  formatBytes,
  isScriptableExtension,
  parentPrefixOf,
  type BucketEntryDto,
  type BucketFolderDto,
  type EntryKind,
  type MediaAssetDto,
} from "@repo/storage/media";
import { Button, IconButton } from "@/components/ui/button";
import { cdnUrl } from "@/lib/utils";
import { deleteAsset, updateAltText } from "@/lib/actions/media";
import { adoptObject, deleteEntries, type MissingAssetDto } from "@/lib/actions/media-browser";
import {
  IconAlertTriangle,
  IconCheck,
  IconChecks,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconFileUnknown,
  IconFolder,
  IconLibraryPlus,
  IconLink,
  IconPhoto,
  IconPhotoOff,
  IconSelect,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

export interface InspectorProps {
  entries: BucketEntryDto[];
  folders: BucketFolderDto[];
  missing: MissingAssetDto[];
  configured: boolean;
  onAltSaved: (key: string, altText: string) => void;
  onAdopted: (asset: MediaAssetDto) => void;
  onRemoved: (keys: string[]) => void;
  onOpenFolder: (prefix: string) => void;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
}

interface Blocked {
  key: string;
  usedIn: string[];
}

const KIND_LABEL: Record<EntryKind, string> = {
  image: "image",
  doc: "document",
  other: "file",
};

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function when(iso: string | null): string {
  if (!iso) return "not recorded";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "not recorded" : stamp.format(at);
}

function folderLabel(key: string): string {
  const parent = parentPrefixOf(key);
  return parent === "" ? "bucket root" : parent;
}

function hintFor(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < MIN_ALT_LENGTH) {
    return `At least ${MIN_ALT_LENGTH} characters — this is stored on a column that cannot be empty.`;
  }
  return altTextIssue(trimmed) !== null
    ? "This still reads like a label rather than a description."
    : "Reads like a description.";
}

function adoptBlocker(entry: BucketEntryDto): string {
  if (entry.kind !== "image") {
    return "Only images join the library — alt text describes a picture, and this is not one. It still lists, moves and deletes here; it will simply never have a library row, so it never shows up in the alt audit either.";
  }
  if (!entry.key.includes("/")) {
    return "A file sitting at the bucket root cannot join the library, because the row records the folder it lives in. Move it into a folder first.";
  }
  if (entry.bytes > MAX_UPLOAD_BYTES) {
    return "Over 10 MB, which is the library ceiling. Adoption only reads the file, so the object is left exactly as it is.";
  }
  return "This file cannot join the library.";
}

function Glyph({ kind }: { kind: EntryKind }) {
  if (kind === "doc") return <IconFileText size={34} stroke={1.2} />;
  return <IconFileUnknown size={34} stroke={1.2} />;
}

function BlockedList({ items }: { items: Blocked[] }) {
  return (
    <div className="mdb-blocked">
      {items.map((item) => (
        <div key={item.key}>
          <b>{item.key}</b>
          <span>{item.usedIn.join(" · ")}</span>
        </div>
      ))}
    </div>
  );
}

function UsedBy({ usedIn }: { usedIn: string[] }) {
  return (
    <div className="md-det-use">
      <div className="md-det-k">referenced by</div>
      {usedIn.length === 0 ? (
        <div className="md-det-none">
          Nothing found. The scan reads project logos and images, blog covers and bodies, experience
          logos and every site setting — an image reached some other way would look the same here, so
          check before deleting.
        </div>
      ) : (
        <ul className="md-det-list">
          {usedIn.map((where) => (
            <li key={where}>{where}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Head({
  icon: Icon,
  title,
  onClearSelection,
}: {
  icon: React.ComponentType<{ size?: number; stroke?: number }>;
  title: string;
  onClearSelection?: () => void;
}) {
  return (
    <div className="mdb-side-h">
      <Icon size={15} stroke={1.6} />
      <div className="mdb-side-t" title={title}>
        {title}
      </div>
      {onClearSelection ? (
        <IconButton onClick={onClearSelection} aria-label="Clear the selection">
          <IconX size={14} stroke={1.7} />
        </IconButton>
      ) : null}
    </div>
  );
}

export function Inspector({
  entries,
  folders,
  missing,
  configured,
  onAltSaved,
  onAdopted,
  onRemoved,
  onOpenFolder,
  onDeleteSelection,
  onClearSelection,
}: InspectorProps) {
  const total = entries.length + folders.length + missing.length;
  const file = total === 1 ? entries[0] : undefined;
  const folder = total === 1 ? folders[0] : undefined;
  const gone = total === 1 ? missing[0] : undefined;

  if (total === 0) {
    return (
      <aside className="mdb-side">
        <Head icon={IconSelect} title="Details" />
        <div className="mdb-side-none">
          <b>Nothing selected</b>
          <span>
            Click a file to see its key, what it weighs and what still points at it. Cmd-click or
            shift-click for several.
          </span>
        </div>
      </aside>
    );
  }

  if (file) {
    return (
      <FilePanel
        key={file.key}
        entry={file}
        configured={configured}
        onAltSaved={onAltSaved}
        onAdopted={onAdopted}
        onRemoved={onRemoved}
        onClearSelection={onClearSelection}
      />
    );
  }

  if (folder) {
    return (
      <FolderPanel
        key={folder.prefix}
        folder={folder}
        configured={configured}
        onOpenFolder={onOpenFolder}
        onDeleteSelection={onDeleteSelection}
        onClearSelection={onClearSelection}
      />
    );
  }

  if (gone) {
    return (
      <MissingPanel
        key={gone.id}
        row={gone}
        onRemoved={onRemoved}
        onClearSelection={onClearSelection}
      />
    );
  }

  return (
    <ManyPanel
      entries={entries}
      folders={folders}
      missing={missing}
      configured={configured}
      onDeleteSelection={onDeleteSelection}
      onClearSelection={onClearSelection}
    />
  );
}

function FilePanel({
  entry,
  configured,
  onAltSaved,
  onAdopted,
  onRemoved,
  onClearSelection,
}: {
  entry: BucketEntryDto;
  configured: boolean;
  onAltSaved: (key: string, altText: string) => void;
  onAdopted: (asset: MediaAssetDto) => void;
  onRemoved: (keys: string[]) => void;
  onClearSelection: () => void;
}) {
  const [value, setValue] = useState(entry.altText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"key" | "url" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [armed, setArmed] = useState(false);

  const id = entry.assetId;
  const trimmed = value.trim();
  const dirty = trimmed !== (entry.altText ?? "").trim();
  const canSave = trimmed.length >= MIN_ALT_LENGTH && !busy && (id === null || dirty);
  const issue = id === null ? null : altTextIssue(entry.altText ?? "");
  const ext = extensionOfKey(entry.key);
  const scriptable = isScriptableExtension(ext);
  const href = cdnUrl(entry.url);
  const dimensions =
    entry.width !== null && entry.height !== null
      ? `${entry.width} × ${entry.height}`
      : natural !== null
        ? `${natural.width} × ${natural.height}`
        : "not recorded";

  const copy = (what: "key" | "url") => {
    const text = what === "key" ? entry.key : href;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (id === null) {
        const res = await adoptObject({
          key: entry.key,
          altText: value,
          width: natural?.width,
          height: natural?.height,
        });
        if (!res.ok || !res.asset) {
          setError(res.error ?? "That file did not join the library.");
          return;
        }
        onAdopted(res.asset);
        setSaved(true);
        return;
      }
      const res = await updateAltText({ id, altText: value });
      if (!res.ok || !res.altText) {
        setError(res.error ?? "That alt text was not saved.");
        return;
      }
      onAltSaved(entry.key, res.altText);
      setSaved(true);
    } catch (e) {
      setError(transportError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (force: boolean) => {
    setRemoving(true);
    setError(null);
    try {
      const res = await deleteEntries({
        keys: [entry.key],
        allowReferenced: force ? [entry.key] : undefined,
      });
      if (!res.ok) {
        setBlocked(res.blocked ?? []);
        setError(res.error ?? "That file was not deleted.");
        setConfirming(false);
        return;
      }
      onRemoved(res.deleted ?? [entry.key]);
    } catch (e) {
      setError(transportError(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <aside className="mdb-side">
      <Head
        icon={
          entry.kind === "image" ? IconPhoto : entry.kind === "doc" ? IconFileText : IconFileUnknown
        }
        title={entry.name}
        onClearSelection={onClearSelection}
      />
      <div className="mdb-side-b">
        <div className="md-det">
          <div className="md-det-img">
            {entry.kind === "image" && !scriptable ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={href}
                alt={entry.altText ?? ""}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={(e) =>
                  setNatural({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
              />
            ) : (
              <>
                <Glyph kind={entry.kind} />
                <span className="mdb-side-k">{ext === "" ? "no extension" : ext}</span>
              </>
            )}
          </div>

          <div className="md-flags">
            {id === null ? (
              <span className="chip amb">not in library</span>
            ) : (
              <span className="chip on">in library</span>
            )}
            {issue ? <span className="chip amb">{ALT_ISSUE_LABEL[issue]}</span> : null}
            {scriptable ? <span className="chip bad">runs as code if opened</span> : null}
            {entry.usedIn.length > 0 ? (
              <span className="chip acc">referenced · {entry.usedIn.length}</span>
            ) : null}
          </div>

          <dl className="md-det-facts">
            <div>
              <dt>kind</dt>
              <dd>{KIND_LABEL[entry.kind]}</dd>
            </div>
            <div>
              <dt>format</dt>
              <dd>{ext === "" ? "none" : ext}</dd>
            </div>
            <div>
              <dt>size</dt>
              <dd>{formatBytes(entry.bytes)}</dd>
            </div>
            <div>
              <dt>dimensions</dt>
              <dd>{dimensions}</dd>
            </div>
            <div>
              <dt>modified</dt>
              <dd>{when(entry.lastModified)}</dd>
            </div>
            <div>
              <dt>folder</dt>
              <dd>{folderLabel(entry.key)}</dd>
            </div>
          </dl>

          <div className="md-det-path">
            <code title={entry.key}>{entry.key}</code>
            <IconButton onClick={() => copy("key")} aria-label="Copy the key">
              {copied === "key" ? (
                <IconCheck size={13} stroke={1.8} />
              ) : (
                <IconCopy size={13} stroke={1.6} />
              )}
            </IconButton>
            {scriptable ? null : (
              <a
                className="ibtn"
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label="Open the original"
              >
                <IconExternalLink size={13} stroke={1.6} />
              </a>
            )}
          </div>

          {scriptable ? (
            <div className="md-det-none">
              <IconAlertTriangle size={13} stroke={1.7} /> A .{ext} is not a picture the browser
              merely paints. cdn.yatindora.in hands it back with the Content-Type it was stored
              under and no X-Content-Type-Options header, so opening the URL loads it as a document
              on that host and whatever script it carries runs there — in the CDN origin, a sibling
              subdomain of the site, with that origin&rsquo;s storage to itself. Nothing on this page
              renders it: the tile above is a glyph, never an inline drawing of the file. Copying the
              URL is harmless. Opening it is not.
            </div>
          ) : null}

          <div className="mdb-side-acts">
            <Button variant="ghost" onClick={() => copy("url")}>
              {copied === "url" ? (
                <IconCheck size={13} stroke={1.8} />
              ) : (
                <IconLink size={13} stroke={1.6} />
              )}
              {copied === "url" ? "Copied" : "Copy URL"}
            </Button>
            {!scriptable ? (
              <a className="btn ghost" href={href} target="_blank" rel="noreferrer">
                <IconExternalLink size={13} stroke={1.6} /> Open original
              </a>
            ) : armed ? (
              <>
                <Button variant="ghost" onClick={() => setArmed(false)}>
                  Keep it closed
                </Button>
                <a
                  className="btn danger"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setArmed(false)}
                >
                  <IconExternalLink size={13} stroke={1.6} /> Run it on cdn.yatindora.in
                </a>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setArmed(true)}>
                <IconAlertTriangle size={13} stroke={1.7} /> Open original…
              </Button>
            )}
          </div>

          {id === null && !entry.adoptable ? (
            <div>
              <div className="md-det-k">not in the library</div>
              <div className="md-det-none">{adoptBlocker(entry)}</div>
            </div>
          ) : null}

          {id === null && entry.adoptable ? (
            <div className="md-det-none">
              This image is in the bucket but has no library row, so it carries no alt text and never
              reaches the audit. Describe it and it joins — the object itself is only read.
            </div>
          ) : null}

          {id !== null || entry.adoptable ? (
            <>
              <div className="f">
                <label htmlFor={`alt-${entry.key}`}>Alt text</label>
                <input
                  id={`alt-${entry.key}`}
                  className="in"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={500}
                  placeholder="Describe the image for someone who cannot see it"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSave) void save();
                  }}
                />
                <div className="f-hint">{hintFor(value)}</div>
              </div>
              <div className="mdb-side-acts">
                <Button onClick={() => void save()} disabled={!canSave}>
                  {id === null ? <IconLibraryPlus size={13} stroke={1.6} /> : null}
                  {busy
                    ? id === null
                      ? "Adopting…"
                      : "Saving…"
                    : id === null
                      ? "Adopt into the library"
                      : "Save alt text"}
                </Button>
                {saved ? (
                  <span className="rv-ok">
                    <IconCheck size={12} stroke={1.8} /> {id === null ? "adopted" : "alt text saved"}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          <UsedBy usedIn={entry.usedIn} />

          {error ? <div className="rv-err">{error}</div> : null}

          {blocked.length > 0 ? (
            <div>
              <div className="md-det-k">still pointed at</div>
              <BlockedList items={blocked} />
            </div>
          ) : null}

          <div className="md-det-danger">
            {blocked.length > 0 ? (
              <>
                <span>
                  Deleting it now leaves those places pointing at a 404. Nothing has been removed
                  yet.
                </span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBlocked([]);
                    setError(null);
                  }}
                  disabled={removing}
                >
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void remove(true)}
                  disabled={removing || !configured}
                >
                  <IconTrash size={13} /> {removing ? "Deleting…" : "Delete anyway"}
                </Button>
              </>
            ) : confirming ? (
              <>
                <span>
                  Delete the object{id === null ? "" : " and the row"}? R2 has no versioning, so
                  there is no undo.
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
                  {!configured
                    ? "Deleting needs the R2 credentials — without them the object cannot be removed."
                    : id === null
                      ? "Removes the object from R2. There is no library row to remove."
                      : "Removes the object from R2 and then the row."}
                </span>
                <Button
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                  disabled={!configured}
                >
                  <IconTrash size={13} /> Delete
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MissingPanel({
  row,
  onRemoved,
  onClearSelection,
}: {
  row: MissingAssetDto;
  onRemoved: (keys: string[]) => void;
  onClearSelection: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [blocked, setBlocked] = useState<Blocked[]>([]);

  const copy = () => {
    void navigator.clipboard.writeText(row.key).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const remove = async (force: boolean) => {
    setRemoving(true);
    setError(null);
    try {
      const res = await deleteAsset({
        id: row.id,
        ...(force ? { allowReferenced: [row.key] } : {}),
      });
      if (!res.ok) {
        setBlocked(res.blocked ?? []);
        setError(res.error ?? "That row was not removed.");
        setConfirming(false);
        return;
      }
      onRemoved([row.key]);
    } catch (e) {
      setError(transportError(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <aside className="mdb-side">
      <Head icon={IconPhotoOff} title={row.filename} onClearSelection={onClearSelection} />
      <div className="mdb-side-b">
        <div className="md-det">
          <div className="md-det-img">
            <IconPhotoOff size={34} stroke={1.2} />
            <span className="mdb-side-k">no object at this key</span>
          </div>

          <div className="md-flags">
            <span className="chip bad">file missing</span>
            {row.usedIn.length > 0 ? (
              <span className="chip acc">referenced · {row.usedIn.length}</span>
            ) : null}
          </div>

          <div className="md-det-none">
            The library has a row for this key and the bucket has nothing at it. Something removed
            the object without the row — another S3 client, the Cloudflare dashboard, or a delete
            that half-finished. The row is all that is left, so it renders nowhere and every
            reference below is already broken.
          </div>

          <dl className="md-det-facts">
            <div>
              <dt>recorded size</dt>
              <dd>{formatBytes(row.bytes)}</dd>
            </div>
            <div>
              <dt>type</dt>
              <dd>{row.mimeType}</dd>
            </div>
            <div>
              <dt>dimensions</dt>
              <dd>{row.width && row.height ? `${row.width} × ${row.height}` : "not recorded"}</dd>
            </div>
            <div>
              <dt>added</dt>
              <dd>{when(row.createdAt)}</dd>
            </div>
            <div>
              <dt>folder</dt>
              <dd>{folderLabel(row.key)}</dd>
            </div>
            <div>
              <dt>alt text</dt>
              <dd>{row.altText === "" ? "none" : row.altText}</dd>
            </div>
          </dl>

          <div className="md-det-path">
            <code title={row.key}>{row.key}</code>
            <IconButton onClick={copy} aria-label="Copy the key">
              {copied ? <IconCheck size={13} stroke={1.8} /> : <IconCopy size={13} stroke={1.6} />}
            </IconButton>
          </div>

          <UsedBy usedIn={row.usedIn} />

          {error ? <div className="rv-err">{error}</div> : null}

          {blocked.length > 0 ? (
            <div>
              <div className="md-det-k">still pointed at</div>
              <BlockedList items={blocked} />
            </div>
          ) : null}

          <div className="md-det-danger">
            {blocked.length > 0 ? (
              <>
                <span>
                  Those places already show a broken image. Removing the row does not fix them, it
                  only stops the library claiming the file exists.
                </span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBlocked([]);
                    setError(null);
                  }}
                  disabled={removing}
                >
                  Keep it
                </Button>
                <Button variant="destructive" onClick={() => void remove(true)} disabled={removing}>
                  <IconTrash size={13} /> {removing ? "Removing…" : "Remove anyway"}
                </Button>
              </>
            ) : confirming ? (
              <>
                <span>
                  Remove the row? Nothing is deleted from the bucket, because there is nothing there
                  to delete.
                </span>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={removing}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => void remove(false)} disabled={removing}>
                  <IconTrash size={13} /> {removing ? "Removing…" : "Yes, remove"}
                </Button>
              </>
            ) : (
              <>
                <span>
                  Clears the stale row so the library stops counting a file that is not there.
                </span>
                <Button variant="destructive" onClick={() => setConfirming(true)}>
                  <IconTrash size={13} /> Remove the row
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function FolderPanel({
  folder,
  configured,
  onOpenFolder,
  onDeleteSelection,
  onClearSelection,
}: {
  folder: BucketFolderDto;
  configured: boolean;
  onOpenFolder: (prefix: string) => void;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(folder.prefix).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <aside className="mdb-side">
      <Head icon={IconFolder} title={folder.name} onClearSelection={onClearSelection} />
      <div className="mdb-side-b">
        <div className="md-det">
          <div className="md-det-img">
            <IconFolder size={34} stroke={1.2} />
            <span className="mdb-side-k">folder</span>
          </div>

          <dl className="md-det-facts">
            <div>
              <dt>name</dt>
              <dd>{folder.name}</dd>
            </div>
            <div>
              <dt>depth</dt>
              <dd>{folder.prefix.split("/").length - 1}</dd>
            </div>
            <div>
              <dt>contents</dt>
              <dd>counted on open</dd>
            </div>
          </dl>

          <div className="md-det-path">
            <code title={folder.prefix}>{folder.prefix}</code>
            <IconButton onClick={copy} aria-label="Copy the prefix">
              {copied ? <IconCheck size={13} stroke={1.8} /> : <IconCopy size={13} stroke={1.6} />}
            </IconButton>
          </div>

          <div className="mdb-side-acts">
            <Button onClick={() => onOpenFolder(folder.prefix)}>
              <IconFolder size={13} stroke={1.6} /> Open
            </Button>
            <Button variant="destructive" onClick={onDeleteSelection} disabled={!configured}>
              <IconTrash size={13} /> Delete folder…
            </Button>
          </div>

          <div className="md-det-none">
            R2 has no directories, only keys that share a prefix, so a folder weighs nothing until
            you look inside it. Deleting one walks the whole subtree, refuses anything the site still
            points at, and asks you to type the name first.
          </div>
        </div>
      </div>
    </aside>
  );
}

function ManyPanel({
  entries,
  folders,
  missing,
  configured,
  onDeleteSelection,
  onClearSelection,
}: {
  entries: BucketEntryDto[];
  folders: BucketFolderDto[];
  missing: MissingAssetDto[];
  configured: boolean;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const total = entries.length + folders.length + missing.length;
  const bytes =
    entries.reduce((sum, e) => sum + e.bytes, 0) + missing.reduce((sum, r) => sum + r.bytes, 0);
  const untracked = entries.filter((e) => e.assetId === null).length;
  const referenced =
    entries.filter((e) => e.usedIn.length > 0).length +
    missing.filter((r) => r.usedIn.length > 0).length;

  const copyUrls = () => {
    const text = entries.map((e) => cdnUrl(e.url)).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <aside className="mdb-side">
      <Head icon={IconChecks} title={`${total} selected`} onClearSelection={onClearSelection} />
      <div className="mdb-side-b">
        <div className="md-det">
          <div>
            <div className="md-det-k">selection</div>
            <div className="mdb-side-sum">
              <div>
                {entries.length} file{entries.length === 1 ? "" : "s"} · {formatBytes(bytes)}
              </div>
              {folders.length > 0 ? (
                <div>
                  {folders.length} folder{folders.length === 1 ? "" : "s"} · size counted on open
                </div>
              ) : null}
              {missing.length > 0 ? (
                <div>
                  {missing.length} row{missing.length === 1 ? "" : "s"} with no file
                </div>
              ) : null}
              {untracked > 0 ? <div>{untracked} not in the library</div> : null}
              {referenced > 0 ? <div>{referenced} still referenced</div> : null}
            </div>
          </div>

          <div>
            <div className="md-det-k">what is picked</div>
            <div className="mdb-blocked">
              {folders.map((f) => (
                <div key={f.prefix}>
                  <b>{f.prefix}</b>
                  <span>folder</span>
                </div>
              ))}
              {entries.map((e) => (
                <div key={e.key}>
                  <b>{e.key}</b>
                  <span>
                    {formatBytes(e.bytes)}
                    {e.assetId === null ? " · not in library" : ""}
                    {e.usedIn.length > 0 ? " · referenced" : ""}
                  </span>
                </div>
              ))}
              {missing.map((r) => (
                <div key={r.id}>
                  <b>{r.key}</b>
                  <span>row only, file missing</span>
                </div>
              ))}
            </div>
          </div>

          {referenced > 0 ? (
            <div className="md-det-none">
              <IconAlertTriangle size={13} stroke={1.7} /> The referenced ones are refused and listed
              back to you rather than deleted quietly, so a delete here can still come back
              incomplete on purpose.
            </div>
          ) : null}

          <div className="mdb-side-acts">
            <Button variant="ghost" onClick={copyUrls} disabled={entries.length === 0}>
              {copied ? <IconCheck size={13} stroke={1.8} /> : <IconLink size={13} stroke={1.6} />}
              {copied ? "Copied" : "Copy URLs"}
            </Button>
            <Button variant="ghost" onClick={onClearSelection}>
              <IconX size={13} stroke={1.6} /> Clear
            </Button>
            <Button variant="destructive" onClick={onDeleteSelection} disabled={!configured}>
              <IconTrash size={13} /> Delete…
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
