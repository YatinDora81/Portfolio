"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  displayNameOf,
  extensionOfKey,
  formatBytes,
  kindOfKey,
  type BucketEntryDto,
  type BucketFolderDto,
} from "@repo/storage/media";
import { cdnUrl, cn } from "@/lib/utils";
import type { MissingAssetDto } from "@/lib/actions/media-browser";
import {
  IconDotsVertical,
  IconFile,
  IconFileTypeCsv,
  IconFileTypePdf,
  IconFileTypeTxt,
  IconFolder,
  IconJson,
  IconMarkdown,
  IconPhotoOff,
} from "@tabler/icons-react";

export type MediaLayout = "grid" | "list";

export type BrowserRow =
  | { kind: "folder"; id: string; name: string; folder: BucketFolderDto }
  | { kind: "file"; id: string; name: string; entry: BucketEntryDto }
  | { kind: "missing"; id: string; name: string; asset: MissingAssetDto };

export interface PickIntent {
  toggle: boolean;
  range: boolean;
}

export interface MediaGridProps {
  rows: readonly BrowserRow[];
  layout: MediaLayout;
  picked: ReadonlySet<string>;
  focusId: string | null;
  dropPrefix: string | null;
  dragging: ReadonlySet<string>;
  tapOpens?: boolean;
  onPick: (row: BrowserRow, intent: PickIntent) => void;
  onOpen: (row: BrowserRow) => void;
  onFocusRow: (id: string) => void;
  onMenu: (row: BrowserRow, x: number, y: number) => void;
  onDragRow: (row: BrowserRow, e: React.DragEvent) => void;
  onDragDone: () => void;
  onFolderOver: (prefix: string | null) => void;
  onFolderDrop: (prefix: string, e: React.DragEvent) => void;
}

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DOC_ICONS: Record<string, typeof IconFile> = {
  md: IconMarkdown,
  pdf: IconFileTypePdf,
  txt: IconFileTypeTxt,
  json: IconJson,
  csv: IconFileTypeCsv,
};

const cell = { fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--dim)", whiteSpace: "nowrap" } as const;

export function browserRows(
  folders: readonly BucketFolderDto[],
  entries: readonly BucketEntryDto[],
  missing: readonly MissingAssetDto[],
): BrowserRow[] {
  const byName = (a: BrowserRow, b: BrowserRow) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const known = new Set(entries.map((e) => e.key));
  const dirs = folders.map((folder): BrowserRow => ({
    kind: "folder",
    id: folder.prefix,
    name: folder.name,
    folder,
  }));
  const files = entries.map((entry): BrowserRow => ({
    kind: "file",
    id: entry.key,
    name: entry.name,
    entry,
  }));
  for (const asset of missing) {
    if (known.has(asset.key)) continue;
    files.push({ kind: "missing", id: asset.key, name: displayNameOf(asset.key), asset });
  }
  return [...dirs.sort(byName), ...files.sort(byName)];
}

function usersOf(row: BrowserRow): string[] {
  if (row.kind === "folder") return [];
  return row.kind === "file" ? row.entry.usedIn : row.asset.usedIn;
}

function usedReason(count: number): string {
  return `Used in ${count} place${count === 1 ? "" : "s"}, so it cannot be dragged to another folder.`;
}

export function moveBlockedReason(row: BrowserRow): string | null {
  if (row.kind === "folder") return "Folders cannot be moved yet.";
  if (row.kind === "missing") return "The object is gone, so there is nothing to move.";
  const used = row.entry.usedIn.length;
  return used === 0 ? null : usedReason(used);
}

function bytesOf(row: BrowserRow): number | null {
  if (row.kind === "file") return row.entry.bytes;
  return row.kind === "missing" ? row.asset.bytes : null;
}

function modifiedOf(row: BrowserRow): string | null {
  if (row.kind === "folder") return null;
  const iso = row.kind === "file" ? row.entry.lastModified : row.asset.createdAt;
  return iso === null ? null : stamp.format(new Date(iso));
}

function metaOf(row: BrowserRow): string {
  if (row.kind === "folder") return "folder";
  const size = bytesOf(row);
  const when = modifiedOf(row);
  const parts = [size === null ? "size unknown" : formatBytes(size)];
  if (row.kind === "missing") parts.push("row only");
  if (when) parts.push(when);
  return parts.join(" · ");
}

function labelOf(row: BrowserRow): string {
  if (row.kind === "folder") return `${row.name}, folder`;
  const marks = [formatBytes(bytesOf(row) ?? 0)];
  if (row.kind === "missing") marks.push("file missing from storage");
  if (row.kind === "file" && row.entry.assetId === null) marks.push("not in library");
  if (usersOf(row).length > 0) marks.push("referenced");
  return `${row.name}, ${marks.join(", ")}`;
}

function chipsOf(row: BrowserRow): React.ReactNode[] {
  const used = usersOf(row);
  const out: React.ReactNode[] = [];
  if (row.kind === "missing") {
    out.push(
      <span key="gone" className="chip bad" title="The row survives but the object is not in the bucket.">
        file missing
      </span>,
    );
  }
  if (row.kind === "file" && row.entry.assetId === null) {
    out.push(
      <span key="untracked" className="chip amb" title="No library row, so it has no alt text.">
        not in library
      </span>,
    );
  }
  if (used.length > 0) {
    out.push(
      <span key="used" className="chip acc" title={usedReason(used.length)}>
        referenced
      </span>,
    );
  }
  return out;
}

function Thumb({ row }: { row: BrowserRow }) {
  if (row.kind === "folder") {
    return (
      <span className="mdb-ic fold" aria-hidden="true">
        <IconFolder size={30} stroke={1.4} />
        <b>folder</b>
      </span>
    );
  }
  if (row.kind === "missing") {
    return (
      <span className="mdb-ic gone" aria-hidden="true">
        <IconPhotoOff size={30} stroke={1.4} />
        <b>{extensionOfKey(row.asset.key) || "gone"}</b>
      </span>
    );
  }
  const { entry } = row;
  if (kindOfKey(entry.key) === "image") {
    return (
      <span
        className="md-thumb"
        style={
          entry.blurDataUrl
            ? { backgroundImage: `url(${entry.blurDataUrl})`, backgroundSize: "cover" }
            : undefined
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cdnUrl(entry.key)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </span>
    );
  }
  const ext = extensionOfKey(entry.key);
  const Glyph = DOC_ICONS[ext] ?? IconFile;
  return (
    <span className="mdb-ic" aria-hidden="true">
      <Glyph size={30} stroke={1.4} />
      <b>{ext || "file"}</b>
    </span>
  );
}

function RowThumb({ row }: { row: BrowserRow }) {
  if (row.kind === "folder") {
    return (
      <span className="mdb-rt fold" aria-hidden="true">
        <IconFolder size={15} stroke={1.5} />
      </span>
    );
  }
  if (row.kind === "missing") {
    return (
      <span className="mdb-rt doc" aria-hidden="true">
        <IconPhotoOff size={15} stroke={1.5} />
      </span>
    );
  }
  if (kindOfKey(row.entry.key) === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="mdb-rt"
        src={cdnUrl(row.entry.key)}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
      />
    );
  }
  const Glyph = DOC_ICONS[extensionOfKey(row.entry.key)] ?? IconFile;
  return (
    <span className="mdb-rt doc" aria-hidden="true">
      <Glyph size={15} stroke={1.5} />
    </span>
  );
}

function useColumns(ref: React.RefObject<HTMLDivElement | null>, on: boolean): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const read = () =>
      setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return on ? cols : 1;
}

export function MediaGrid({
  rows,
  layout,
  picked,
  focusId,
  dropPrefix,
  dragging,
  tapOpens = false,
  onPick,
  onOpen,
  onFocusRow,
  onMenu,
  onDragRow,
  onDragDone,
  onFolderOver,
  onFolderDrop,
}: MediaGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cols = useColumns(rootRef, layout === "grid");

  const rovingId = useMemo(() => {
    if (focusId && rows.some((r) => r.id === focusId)) return focusId;
    return rows[0]?.id ?? null;
  }, [focusId, rows]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !focusId || !root.contains(document.activeElement)) return;
    const el = root.querySelector<HTMLElement>(`[data-row="${CSS.escape(focusId)}"]`);
    if (!el || el === document.activeElement) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || rows.length === 0) return;
    const at = Math.max(0, rows.findIndex((r) => r.id === rovingId));
    const to = (next: number) => {
      const row = rows[Math.min(rows.length - 1, Math.max(0, next))];
      if (!row) return;
      e.preventDefault();
      onFocusRow(row.id);
      if (e.shiftKey) onPick(row, { toggle: false, range: true });
    };
    if (e.key === "ArrowRight") to(at + 1);
    else if (e.key === "ArrowLeft") to(at - 1);
    else if (e.key === "ArrowDown") to(at + cols);
    else if (e.key === "ArrowUp") to(at - cols);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(rows.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      const row = rows[at];
      if (!row) return;
      e.preventDefault();
      if (e.key === " ") onPick(row, { toggle: true, range: false });
      else onOpen(row);
    }
  };

  const click = (row: BrowserRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tapOpens && row.kind === "folder" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      onOpen(row);
      return;
    }
    onPick(row, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
  };

  const rowProps = (row: BrowserRow) => {
    const target = row.kind === "folder" ? row.folder.prefix : null;
    const over = (e: React.DragEvent) => {
      if (target === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move";
      onFolderOver(target);
    };
    return {
      draggable: moveBlockedReason(row) === null,
      onDragStart: (e: React.DragEvent) => onDragRow(row, e),
      onDragEnd: () => onDragDone(),
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: (e: React.DragEvent) => {
        if (target === null) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFolderOver(null);
      },
      onDrop: (e: React.DragEvent) => {
        if (target === null) return;
        e.preventDefault();
        onFolderOver(null);
        onFolderDrop(target, e);
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(row, e.clientX, e.clientY);
      },
      onDoubleClick: () => onOpen(row),
      onFocus: () => onFocusRow(row.id),
    };
  };

  const stateOf = (row: BrowserRow) =>
    cn(
      picked.has(row.id) && "picked",
      row.id === rovingId && "kfoc",
      dragging.has(row.id) && "grab",
      row.kind === "folder" && dropPrefix === row.id && "drop",
    );

  if (rows.length === 0) return null;

  if (layout === "list") {
    return (
      <div className="mdb-rows" ref={rootRef} onKeyDown={onKeyDown}>
        <div className="tbl-scroll">
          <table className="tbl" role="grid" aria-multiselectable="true" aria-label="Bucket contents">
            <thead>
              <tr>
                <th className="mdb-rck">
                  <span className="sr-only">Select</span>
                </th>
                <th>Name</th>
                <th>State</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const size = bytesOf(row);
                const when = modifiedOf(row);
                const marks = chipsOf(row);
                return (
                  <tr
                    key={row.id}
                    data-row={row.id}
                    tabIndex={row.id === rovingId ? 0 : -1}
                    aria-selected={picked.has(row.id)}
                    aria-label={labelOf(row)}
                    className={cn("mdb-r", stateOf(row))}
                    onClick={(e) => click(row, e)}
                    {...rowProps(row)}
                  >
                    <td className="mdb-rck">
                      <input
                        type="checkbox"
                        checked={picked.has(row.id)}
                        onChange={() => onPick(row, { toggle: true, range: false })}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td>
                      <span className="mdb-rn">
                        <RowThumb row={row} />
                        <span title={row.id}>{row.name}</span>
                      </span>
                    </td>
                    <td>{marks.length > 0 ? <span className="mdb-rn">{marks}</span> : null}</td>
                    <td style={cell}>{size === null ? "—" : formatBytes(size)}</td>
                    <td style={cell}>{when ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div
      className="md-grid"
      ref={rootRef}
      role="grid"
      aria-multiselectable="true"
      aria-label="Bucket contents"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const marks = chipsOf(row);
        return (
          <article
            key={row.id}
            role="row"
            aria-selected={picked.has(row.id)}
            className={cn("md-cell mdb-cell", stateOf(row), row.kind === "missing" && "gone")}
            {...rowProps(row)}
          >
            <button
              type="button"
              role="gridcell"
              data-row={row.id}
              className="mdb-hit"
              tabIndex={row.id === rovingId ? 0 : -1}
              aria-label={labelOf(row)}
              onClick={(e) => click(row, e)}
            />
            <label className="mdb-ck">
              <input
                type="checkbox"
                checked={picked.has(row.id)}
                onChange={() => onPick(row, { toggle: true, range: false })}
                aria-label={`Select ${row.name}`}
              />
            </label>
            <button
              type="button"
              className="mdb-kebab"
              tabIndex={-1}
              aria-label={`Actions for ${row.name}`}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(row, r.left, r.bottom + 2);
              }}
            >
              <IconDotsVertical size={13} />
            </button>
            <Thumb row={row} />
            <span className="md-cell-b">
              <span className="md-name" title={row.id}>
                {row.name}
              </span>
              <span className="md-meta">{metaOf(row)}</span>
              {marks.length > 0 ? <span className="md-flags">{marks}</span> : null}
            </span>
          </article>
        );
      })}
    </div>
  );
}
