"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  crumbsOf,
  formatBytes,
  isBucketPrefix,
  leafNameOf,
  parentPrefixOf,
  sanitizeSegment,
  type BucketEntryDto,
  type BucketFolderDto,
  type MediaAssetDto,
} from "@repo/storage/media";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cdnUrl, cn } from "@/lib/utils";
import {
  browseFolder,
  createFolder,
  deleteEntries,
  deleteFolder,
  moveFiles,
  planFolderDelete,
  renameAsset,
  type MissingAssetDto,
} from "@/lib/actions/media-browser";
import {
  IconAlertTriangle,
  IconArrowsMove,
  IconChecks,
  IconCloudUpload,
  IconCopy,
  IconCornerLeftUp,
  IconDatabase,
  IconExternalLink,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderUp,
  IconLayoutGrid,
  IconLink,
  IconList,
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconSelectAll,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  MediaGrid,
  browserRows,
  moveBlockedReason,
  type BrowserRow,
  type MediaLayout,
  type PickIntent,
} from "./grid";
import { Inspector } from "./inspector";
import { FolderRail } from "./rail";
import { ContextMenu, type MenuEntry } from "./menu";
import {
  MAX_DROP_FILES,
  createDragDepth,
  hasFiles,
  snapshotDrop,
  walkEntries,
  type DroppedFile,
} from "./dropzone";

const LAYOUT_COOKIE = "cr_mdb_view";
const FOLDER_PASSES = 40;
const MOVE_PASSES = 40;
const DELETE_BATCH = 200;
const MOVE_BATCH = 100;
const PEEK_MS = 350;

export interface BucketChange {
  removed?: string[];
  upserted?: MediaAssetDto[];
  moved?: { from: string; to: string }[];
  altered?: { key: string; altText: string }[];
  renamed?: { id: string; filename: string }[];
}

export interface MediaBrowserProps {
  initialPrefix: string;
  storage: { configured: boolean; missing: string[] };
  reloadKey?: number;
  onNavigate?: (prefix: string) => void;
  onEnqueue?: (files: readonly DroppedFile[], root: string) => void;
  onPickFiles?: (root: string) => void;
  onPickFolder?: (root: string) => void;
  onLibraryChanged?: (change: BucketChange) => void;
}

interface Page {
  folders: BucketFolderDto[];
  entries: BucketEntryDto[];
  missing: MissingAssetDto[];
  cursor: string | null;
  complete: boolean;
  slugStable: boolean;
}

interface Blocked {
  key: string;
  usedIn: string[];
}

interface Notice {
  text: string;
  bad: boolean;
}

interface DeleteRequest {
  entries: BucketEntryDto[];
  folders: BucketFolderDto[];
  missing: MissingAssetDto[];
}

interface FolderPlan {
  prefix: string;
  name: string;
  objects: number;
  folders: number;
  bytes: number;
  referenced: Blocked[];
  truncated: boolean;
  error: string | null;
}

const moreBar = { display: "flex", justifyContent: "center", padding: "0 14px 20px" } as const;
const nameField = { maxWidth: 240, padding: "5px 10px", fontSize: 12.5 } as const;

function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function nameOf(prefix: string): string {
  return prefix === "" ? "the bucket root" : leafNameOf(prefix);
}

function parentOf(prefix: string): string {
  return prefix === "" ? "" : parentPrefixOf(prefix.slice(0, -1));
}

function pathFor(prefix: string): string {
  return prefix === "" ? "/media" : `/media?path=${encodeURIComponent(prefix)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function selectionOf(rows: readonly BrowserRow[]): ReadonlyMap<string, BrowserRow> {
  return new Map(rows.map((row) => [row.id, row] as const));
}

function readLayout(): MediaLayout {
  return document.cookie.split("; ").includes(`${LAYOUT_COOKIE}=list`) ? "list" : "grid";
}

function writeLayout(next: MediaLayout): void {
  document.cookie = `${LAYOUT_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
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

export function MediaBrowser({
  initialPrefix,
  storage,
  reloadKey = 0,
  onNavigate,
  onEnqueue,
  onPickFiles,
  onPickFolder,
  onLibraryChanged,
}: MediaBrowserProps) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [pages, setPages] = useState<ReadonlyMap<string, Page>>(() => new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [fails, setFails] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [picked, setPicked] = useState<ReadonlyMap<string, BrowserRow>>(() => new Map());
  const [dragIds, setDragIds] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [layout, setLayout] = useState<MediaLayout>("grid");
  const [coarse, setCoarse] = useState(false);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; row: BrowserRow | null } | null>(null);
  const [dropPrefix, setDropPrefix] = useState<string | null>(null);
  const [crumbDrop, setCrumbDrop] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<DeleteRequest | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; key: string; value: string } | null>(null);
  const [working, setWorking] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const prefixRef = useRef(initialPrefix);
  const inflight = useRef<Map<string, Promise<void>>>(new Map());
  const queued = useRef<Map<string, Promise<void>>>(new Map());
  const stamps = useRef<Map<string, number>>(new Map());
  const dragged = useRef<string[]>([]);
  const depth = useRef(createDragDepth());
  const peek = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const told = useRef(onNavigate);

  const load = useCallback(async (target: string, from: string | null) => {
    const stamp = (stamps.current.get(target) ?? 0) + 1;
    stamps.current.set(target, stamp);
    setBusy((prev) => new Set(prev).add(target));

    try {
      const res = await browseFolder({ prefix: target, cursor: from });
      if (stamps.current.get(target) !== stamp) return;
      if (!res.ok) {
        setFails((prev) => new Map(prev).set(target, res.error ?? "That folder could not be read."));
        return;
      }
      const page: Page = {
        folders: res.folders ?? [],
        entries: res.entries ?? [],
        missing: res.missing ?? [],
        cursor: res.cursor ?? null,
        complete: res.complete ?? false,
        slugStable: res.slugStable ?? false,
      };
      setFails((prev) => {
        if (!prev.has(target)) return prev;
        const next = new Map(prev);
        next.delete(target);
        return next;
      });
      setPages((prev) => {
        const next = new Map(prev);
        const had = from === null ? undefined : prev.get(target);
        if (!had) {
          next.set(target, page);
          return next;
        }
        const seen = new Set(had.entries.map((e) => e.key));
        const dirs = new Set(had.folders.map((f) => f.prefix));
        next.set(target, {
          ...page,
          folders: [...had.folders, ...page.folders.filter((f) => !dirs.has(f.prefix))],
          entries: [...had.entries, ...page.entries.filter((e) => !seen.has(e.key))],
          missing: had.missing,
        });
        return next;
      });
    } catch (e) {
      setFails((prev) => new Map(prev).set(target, transportError(e)));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
    }
  }, []);

  const fetchPage = useCallback(
    (target: string, from: string | null): Promise<void> => {
      const lane = `${target} ${from ?? ""}`;
      const waiting = queued.current.get(lane);
      if (waiting) return waiting;

      const begin = (): Promise<void> => {
        const run = load(target, from).finally(() => inflight.current.delete(lane));
        inflight.current.set(lane, run);
        return run;
      };

      const running = inflight.current.get(lane);
      if (!running) return begin();

      const next = running.then(() => {
        queued.current.delete(lane);
        return begin();
      });
      queued.current.set(lane, next);
      return next;
    },
    [load],
  );

  const revalidate = useCallback(
    (targets: Iterable<string>) => {
      const stale = new Set(targets);
      setPages((prev) => {
        const next = new Map(prev);
        for (const target of stale) if (target !== prefixRef.current) next.delete(target);
        return next;
      });
      for (const target of stale) if (target === prefixRef.current) void fetchPage(target, null);
    },
    [fetchPage],
  );

  useEffect(() => {
    told.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    setLayout(readLayout());
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    window.history.replaceState(null, "", pathFor(prefixRef.current));
  }, []);

  useEffect(() => {
    const back = () => {
      if (window.location.pathname !== "/media") return;
      const raw = new URLSearchParams(window.location.search).get("path") ?? "";
      const next = isBucketPrefix(raw) ? raw : "";
      prefixRef.current = next;
      setPrefix(next);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  useEffect(() => {
    told.current?.(prefix);
    setAnchor(null);
    setFocusId(null);
    setQ("");
    setCreating(false);
    bodyRef.current?.scrollTo({ top: 0 });
    void fetchPage(prefix, null);
  }, [prefix, fetchPage]);

  useEffect(() => {
    if (reloadKey > 0) void fetchPage(prefixRef.current, null);
  }, [reloadKey, fetchPage]);

  useEffect(
    () => () => {
      if (peek.current) clearTimeout(peek.current.timer);
    },
    [],
  );

  const go = useCallback((next: string) => {
    if (!isBucketPrefix(next) || next === prefixRef.current) return;
    prefixRef.current = next;
    window.history.pushState(null, "", pathFor(next));
    setPrefix(next);
  }, []);

  const page = pages.get(prefix) ?? null;
  const failure = fails.get(prefix) ?? null;
  const loading = busy.has(prefix);

  const rows = useMemo(
    () => (page ? browserRows(page.folders, page.entries, page.missing) : []),
    [page],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter(
      (row) => row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
    );
  }, [q, rows]);

  const index = useMemo(() => {
    const map = new Map<string, BrowserRow>();
    for (const cached of pages.values()) {
      for (const row of browserRows(cached.folders, cached.entries, cached.missing)) {
        map.set(row.id, row);
      }
    }
    return map;
  }, [pages]);

  const chosen = useMemo(() => {
    const entries: BucketEntryDto[] = [];
    const folders: BucketFolderDto[] = [];
    const missing: MissingAssetDto[] = [];
    for (const [id, held] of picked) {
      const row = index.get(id) ?? held;
      if (row.kind === "folder") folders.push(row.folder);
      else if (row.kind === "file") entries.push(row.entry);
      else missing.push(row.asset);
    }
    return { entries, folders, missing };
  }, [index, picked]);

  const pickedIds = useMemo(() => new Set(picked.keys()), [picked]);

  const count = picked.size;
  const elsewhere = useMemo(
    () => [...picked.keys()].filter((id) => !rows.some((row) => row.id === id)).length,
    [picked, rows],
  );

  const say = useCallback((text: string, bad = false) => setNotice({ text, bad }), []);

  const copy = useCallback(
    (text: string, what: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => say(`${what} copied.`))
        .catch(() => say("The clipboard refused that.", true));
    },
    [say],
  );

  const clear = useCallback(() => {
    setPicked(new Map());
    setAnchor(null);
  }, []);

  const dropIds = useCallback((ids: readonly string[]) => {
    const gone = new Set(ids);
    const trees = ids.filter((id) => id.endsWith("/"));
    setPages((prev) => {
      const next = new Map<string, Page>();
      for (const [at, cached] of prev) {
        if (trees.some((tree) => at.startsWith(tree))) continue;
        next.set(at, {
          ...cached,
          folders: cached.folders.filter((f) => !gone.has(f.prefix)),
          entries: cached.entries.filter((e) => !gone.has(e.key)),
          missing: cached.missing.filter((m) => !gone.has(m.key)),
        });
      }
      return next;
    });
    setPicked((prev) => {
      const next = new Map(prev);
      for (const id of prev.keys()) {
        if (gone.has(id) || trees.some((tree) => id.startsWith(tree))) next.delete(id);
      }
      return next;
    });
  }, []);

  const patchEntry = useCallback((key: string, fn: (entry: BucketEntryDto) => BucketEntryDto) => {
    setPages((prev) => {
      const next = new Map(prev);
      for (const [at, cached] of prev) {
        if (!cached.entries.some((e) => e.key === key)) continue;
        next.set(at, { ...cached, entries: cached.entries.map((e) => (e.key === key ? fn(e) : e)) });
      }
      return next;
    });
  }, []);

  const pick = useCallback(
    (row: BrowserRow, intent: PickIntent) => {
      setPicked((prev) => {
        if (intent.range && anchor !== null && anchor !== row.id) {
          const from = visible.findIndex((r) => r.id === anchor);
          const to = visible.findIndex((r) => r.id === row.id);
          if (from >= 0 && to >= 0) {
            const span = from < to ? visible.slice(from, to + 1) : visible.slice(to, from + 1);
            return selectionOf(span);
          }
        }
        if (intent.toggle) {
          const next = new Map(prev);
          if (next.has(row.id)) next.delete(row.id);
          else next.set(row.id, row);
          return next;
        }
        return selectionOf([row]);
      });
      if (!intent.range) setAnchor(row.id);
      setFocusId(row.id);
    },
    [anchor, visible],
  );

  const open = useCallback(
    (row: BrowserRow) => {
      if (row.kind === "folder") {
        go(row.folder.prefix);
        return;
      }
      if (row.kind === "file") window.open(cdnUrl(row.entry.url), "_blank", "noreferrer");
    },
    [go],
  );

  const takeDrop = useCallback(
    (files: readonly DroppedFile[], root: string) => {
      if (files.length === 0) {
        say("Nothing readable came out of that drop — an empty folder, or files the browser hid.", true);
        return;
      }
      if (!onEnqueue) {
        say("This pane has no upload queue attached, so the drop was ignored.", true);
        return;
      }
      onEnqueue(files, root);
      const capped = files.length >= MAX_DROP_FILES;
      say(
        capped
          ? `Only the first ${MAX_DROP_FILES} went into ${nameOf(root)}. Drop the rest once these land.`
          : `${plural(files.length, "file", "files")} queued for ${nameOf(root)}.`,
        capped,
      );
    },
    [onEnqueue, say],
  );

  const move = useCallback(
    async (keys: readonly string[], to: string) => {
      if (to === "") {
        say("The bucket root cannot hold files. Drop them into a folder.", true);
        return;
      }
      const wanted = keys.filter((key) => parentPrefixOf(key) !== to);
      if (wanted.length === 0) {
        say(`Already in ${nameOf(to)}.`);
        return;
      }

      const moved: { from: string; to: string }[] = [];
      const refused: { key: string; reason: string }[] = [];
      let left = [...wanted];
      let stopped: string | null = null;

      setWorking(true);
      try {
        for (let pass = 0; left.length > 0 && pass < MOVE_PASSES; pass += 1) {
          const res = await moveFiles({ keys: left.slice(0, MOVE_BATCH), to });
          const step = res.moved ?? [];
          const kept = res.refused ?? [];
          moved.push(...step);
          refused.push(...kept);
          if (step.length === 0 && kept.length === 0) {
            stopped = res.error ?? "Nothing moved.";
            break;
          }
          const settled = new Set([...step.map((one) => one.from), ...kept.map((one) => one.key)]);
          left = left.filter((key) => !settled.has(key));
        }
      } catch (e) {
        stopped = transportError(e);
      } finally {
        setWorking(false);
      }

      if (moved.length > 0) {
        onLibraryChanged?.({ moved });
        const touched = new Set([to, prefixRef.current]);
        for (const step of moved) touched.add(parentPrefixOf(step.from));
        dropIds(moved.map((step) => step.from));
        revalidate(touched);
      }

      const first = refused[0];
      const kept =
        refused.length === 0
          ? ""
          : ` ${plural(refused.length, "file was", "files were")} left: ${first?.reason ?? ""}`;
      const unreached =
        left.length === 0
          ? ""
          : ` ${stopped ?? `${plural(left.length, "file was", "files were")} not reached — run it again.`}`;
      say(
        moved.length === 0
          ? (stopped ?? first?.reason ?? "Nothing moved.")
          : `Moved ${plural(moved.length, "file", "files")} into ${nameOf(to)}.${kept}${unreached}`,
        refused.length > 0 || left.length > 0,
      );
    },
    [dropIds, onLibraryChanged, revalidate, say],
  );

  const endDrag = useCallback(() => {
    dragged.current = [];
    setDragIds(new Set());
    setDropPrefix(null);
    setCrumbDrop(null);
  }, []);

  const dropInto = useCallback(
    (target: string, e: React.DragEvent) => {
      depth.current.reset();
      setOver(false);
      setDropPrefix(null);
      setCrumbDrop(null);
      if (hasFiles(e.dataTransfer)) {
        const snapshot = snapshotDrop(e.dataTransfer);
        void walkEntries(snapshot).then((files) => takeDrop(files, target));
        return;
      }
      const keys = dragged.current;
      endDrag();
      if (keys.length > 0) void move(keys, target);
    },
    [endDrag, move, takeDrop],
  );

  const onDragRow = useCallback(
    (row: BrowserRow, e: React.DragEvent) => {
      const inside = picked.has(row.id);
      const dragging = inside ? picked : selectionOf([row]);
      if (!inside) {
        setPicked(dragging);
        setAnchor(row.id);
      }
      const keys = [...dragging]
        .map(([id, held]) => index.get(id) ?? held)
        .filter((found) => moveBlockedReason(found) === null)
        .map((found) => found.id);
      dragged.current = keys;
      setDragIds(new Set(dragging.keys()));
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", keys.join("\n"));
    },
    [index, picked],
  );

  const accepts = useCallback(
    (target: string, e: React.DragEvent) =>
      dragged.current.length > 0 ? target !== "" : hasFiles(e.dataTransfer),
    [],
  );

  const peekAt = useCallback(
    (id: string | null) => {
      if (peek.current?.id === id) return;
      if (peek.current) clearTimeout(peek.current.timer);
      peek.current = null;
      if (id === null || !id.endsWith("/") || pages.has(id) || fails.has(id)) return;
      peek.current = {
        id,
        timer: setTimeout(() => {
          peek.current = null;
          void fetchPage(id, null);
        }, PEEK_MS),
      };
    },
    [fails, fetchPage, pages],
  );

  const beginDelete = useCallback(() => {
    if (!storage.configured) {
      say("Deleting needs the R2 credentials — without them nothing can be removed.", true);
      return;
    }
    if (count === 0) return;
    setMenu(null);
    setConfirming({ entries: chosen.entries, folders: chosen.folders, missing: chosen.missing });
  }, [chosen, count, say, storage.configured]);

  const finishDelete = useCallback(
    (removed: string[], prefixes: string[], text: string, bad: boolean) => {
      setConfirming(null);
      if (removed.length > 0) onLibraryChanged?.({ removed });
      if (removed.length > 0 || prefixes.length > 0) {
        dropIds([...removed, ...prefixes]);
        const touched = new Set([prefixRef.current, ...prefixes.map(parentOf)]);
        for (const key of removed) touched.add(parentPrefixOf(key));
        revalidate(touched);
      }
      say(text, bad);
    },
    [dropIds, onLibraryChanged, revalidate, say],
  );

  const makeFolder = useCallback(async () => {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (sanitizeSegment(name) === "") return;
    setWorking(true);
    try {
      const res = await createFolder({ prefix, name });
      if (!res.ok) {
        say(res.error ?? "That folder could not be made.", true);
        return;
      }
      await fetchPage(prefix, null);
      if (res.prefix) setFocusId(res.prefix);
      say(
        res.created === false
          ? `“${res.name}” was already there.`
          : `Created “${res.name}” in ${nameOf(prefix)}.`,
      );
    } catch (e) {
      say(transportError(e), true);
    } finally {
      setWorking(false);
    }
  }, [fetchPage, newName, prefix, say]);

  const makeSibling = useCallback(async () => {
    setWorking(true);
    try {
      const res = await createFolder({ prefix: parentOf(prefix), name: leafNameOf(prefix) });
      if (!res.ok || !res.prefix) {
        say(res.error ?? "That folder could not be made.", true);
        return;
      }
      revalidate([parentOf(prefix)]);
      go(res.prefix);
      say(`“${res.name}” is an upload target. The old folder is untouched.`);
    } catch (e) {
      say(transportError(e), true);
    } finally {
      setWorking(false);
    }
  }, [go, prefix, revalidate, say]);

  const rename = useCallback(async () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (value === "") return;
    setWorking(true);
    try {
      const res = await renameAsset({ id: renaming.id, filename: value });
      if (!res.ok || !res.filename) {
        say(res.error ?? "That name was not saved.", true);
        return;
      }
      onLibraryChanged?.({ renamed: [{ id: renaming.id, filename: res.filename }] });
      setRenaming(null);
      say(`The library now calls it “${res.filename}”.`);
    } catch (e) {
      say(transportError(e), true);
    } finally {
      setWorking(false);
    }
  }, [onLibraryChanged, renaming, say]);

  const startRename = useCallback(() => {
    const one = chosen.entries.length === 1 ? chosen.entries[0] : undefined;
    if (!one || one.assetId === null) {
      say("Renaming needs a library row — adopt the file first.", true);
      return;
    }
    setMenu(null);
    setRenaming({ id: one.assetId, key: one.key, value: one.name });
  }, [chosen.entries, say]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    if (e.key === "Escape") {
      if (target === searchRef.current) {
        e.preventDefault();
        setQ("");
        return;
      }
      if (typing) return;
      e.preventDefault();
      if (menu) setMenu(null);
      else if (q !== "") setQ("");
      else clear();
      return;
    }
    if (typing || e.altKey) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setPicked(selectionOf(visible));
      setAnchor(visible[0]?.id ?? null);
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      beginDelete();
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    }
  };

  const dragKeysOf = () =>
    chosen.entries.filter((entry) => entry.usedIn.length === 0).map((entry) => entry.key);

  const menuItems = (row: BrowserRow | null): MenuEntry[] => {
    if (row === null) {
      return [
        { key: "new", label: "New folder", icon: IconFolderPlus, run: () => setCreating(true) },
        {
          key: "up",
          label: "Upload files…",
          icon: IconCloudUpload,
          disabled: !onPickFiles,
          reason: onPickFiles ? undefined : "The upload queue is not attached to this pane.",
          run: () => onPickFiles?.(prefix),
        },
        {
          key: "updir",
          label: "Upload a folder…",
          icon: IconFolderUp,
          disabled: !onPickFolder,
          reason: onPickFolder ? undefined : "The upload queue is not attached to this pane.",
          run: () => onPickFolder?.(prefix),
        },
        "sep",
        {
          key: "all",
          label: "Select everything here",
          icon: IconSelectAll,
          kb: "⌘A",
          disabled: visible.length === 0,
          run: () => setPicked(selectionOf(visible)),
        },
        { key: "reload", label: "Refresh", icon: IconRefresh, run: () => void fetchPage(prefix, null) },
      ];
    }

    const many = picked.has(row.id) && count > 1;
    const label = many ? `Delete ${plural(count, "item", "items")}…` : "Delete…";

    if (row.kind === "folder") {
      return [
        { key: "open", label: "Open", icon: IconFolderOpen, kb: "↵", run: () => go(row.folder.prefix) },
        { key: "copy", label: "Copy the prefix", icon: IconCopy, run: () => copy(row.folder.prefix, "Prefix") },
        "sep",
        {
          key: "del",
          label,
          icon: IconTrash,
          danger: true,
          disabled: !storage.configured,
          reason: storage.configured ? undefined : "Deleting needs the R2 credentials.",
          run: beginDelete,
        },
      ];
    }

    if (row.kind === "missing") {
      return [
        { key: "copy", label: "Copy the key", icon: IconCopy, run: () => copy(row.asset.key, "Key") },
        "sep",
        {
          key: "del",
          label: many ? label : "Remove the stale row…",
          icon: IconTrash,
          danger: true,
          disabled: !storage.configured,
          reason: storage.configured ? undefined : "Deleting needs the R2 credentials.",
          run: beginDelete,
        },
      ];
    }

    const blockedMove = moveBlockedReason(row);
    const up = parentOf(prefix);
    return [
      {
        key: "open",
        label: "Open the original",
        icon: IconExternalLink,
        href: cdnUrl(row.entry.url),
        newTab: true,
      },
      { key: "url", label: "Copy the URL", icon: IconLink, run: () => copy(cdnUrl(row.entry.url), "URL") },
      { key: "key", label: "Copy the key", icon: IconCopy, run: () => copy(row.entry.key, "Key") },
      "sep",
      {
        key: "rename",
        label: "Rename in the library",
        icon: IconPencil,
        kb: "F2",
        disabled: row.entry.assetId === null,
        reason:
          row.entry.assetId === null
            ? "There is no library row yet, so there is no name to change."
            : undefined,
        run: () => {
          setPicked(selectionOf([row]));
          if (row.entry.assetId !== null) {
            setRenaming({ id: row.entry.assetId, key: row.entry.key, value: row.entry.name });
          }
        },
      },
      {
        key: "moveup",
        label: up === "" ? "Move up" : `Move up to “${leafNameOf(up)}”`,
        icon: IconArrowsMove,
        disabled: blockedMove !== null || up === "" || working,
        reason:
          blockedMove ??
          (up === "" ? "The bucket root cannot hold files, so there is nowhere up to go." : undefined),
        run: () => void move(picked.has(row.id) ? dragKeysOf() : [row.entry.key], up),
      },
      "sep",
      {
        key: "del",
        label,
        icon: IconTrash,
        danger: true,
        disabled: !storage.configured,
        reason: storage.configured ? undefined : "Deleting needs the R2 credentials.",
        run: beginDelete,
      },
    ];
  };

  const trail = crumbsOf(prefix);
  const files = page?.entries.length ?? 0;
  const bytes = page?.entries.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0;
  const dirs = page?.folders.length ?? 0;
  const stale = page !== null && loading;

  const crumbProps = (target: string) => ({
    onDragEnter: (e: React.DragEvent) => {
      if (!accepts(target, e)) return;
      e.preventDefault();
      setCrumbDrop(target);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(target, e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dragged.current.length > 0 ? "move" : "copy";
      setCrumbDrop(target);
    },
    onDragLeave: () => setCrumbDrop((prev) => (prev === target ? null : prev)),
    onDrop: (e: React.DragEvent) => {
      if (!accepts(target, e)) return;
      e.preventDefault();
      e.stopPropagation();
      dropInto(target, e);
    },
  });

  return (
    <div className="mdb">
      <FolderRail
        prefix={prefix}
        folders={page?.folders}
        dragging={dragIds.size > 0}
        onNavigate={go}
        onDropInto={dropInto}
        onCreated={() => void fetchPage(prefix, null)}
      />

      <div className="mdb-main" onKeyDown={onKeyDown}>
        <div className="md-bar">
          <IconButton
            onClick={() => go(parentOf(prefix))}
            disabled={prefix === ""}
            aria-label="Go to the folder above"
            title="Go to the folder above"
          >
            <IconCornerLeftUp size={15} stroke={1.6} />
          </IconButton>

          <nav className="mdb-crumbs" aria-label="Folder trail">
            <button
              type="button"
              className={cn("mdb-crumb", prefix === "" && "on", crumbDrop === "" && "drop")}
              onClick={() => go("")}
              {...crumbProps("")}
            >
              <IconDatabase size={12} /> bucket
            </button>
            {trail.map((crumb) => (
              <Fragment key={crumb.prefix}>
                <span className="mdb-crumb-sep" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  className={cn(
                    "mdb-crumb",
                    crumb.prefix === prefix && "on",
                    crumbDrop === crumb.prefix && "drop",
                  )}
                  onClick={() => go(crumb.prefix)}
                  title={crumb.prefix}
                  {...crumbProps(crumb.prefix)}
                >
                  {crumb.name}
                </button>
              </Fragment>
            ))}
          </nav>

          <span className="sp" />

          <div className="md-search">
            <IconSearch size={14} stroke={1.7} />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter this folder"
              aria-label="Filter this folder"
            />
            {q !== "" ? (
              <IconButton onClick={() => setQ("")} aria-label="Clear the filter">
                <IconX size={13} stroke={1.7} />
              </IconButton>
            ) : null}
          </div>

          <div className="an-split" role="group" aria-label="Layout">
            <button
              type="button"
              className={cn("an-split-b", layout === "grid" && "on")}
              aria-pressed={layout === "grid"}
              onClick={() => {
                setLayout("grid");
                writeLayout("grid");
              }}
            >
              <IconLayoutGrid size={13} /> grid
            </button>
            <button
              type="button"
              className={cn("an-split-b", layout === "list" && "on")}
              aria-pressed={layout === "list"}
              onClick={() => {
                setLayout("list");
                writeLayout("list");
              }}
            >
              <IconList size={13} /> list
            </button>
          </div>

          <Button
            variant="ghost"
            onClick={() => {
              setCreating(true);
              setNewName("");
              window.setTimeout(() => newRef.current?.focus(), 0);
            }}
          >
            <IconFolderPlus size={13} stroke={1.6} /> New folder
          </Button>
          <Button variant="ghost" onClick={() => onPickFiles?.(prefix)} disabled={!onPickFiles}>
            <IconCloudUpload size={13} stroke={1.6} /> Upload
          </Button>
          <Button variant="ghost" onClick={() => onPickFolder?.(prefix)} disabled={!onPickFolder}>
            <IconFolderUp size={13} stroke={1.6} /> Folder
          </Button>
          <IconButton
            onClick={() => void fetchPage(prefix, null)}
            aria-label="Read this folder again"
            title="Read this folder again"
          >
            {loading ? <IconLoader2 size={15} className="spin" /> : <IconRefresh size={15} stroke={1.6} />}
          </IconButton>
        </div>

        {creating ? (
          <div className="mdb-scope">
            <IconFolderPlus size={12} />
            <input
              ref={newRef}
              className="in"
              style={nameField}
              value={newName}
              placeholder="Folder name…"
              aria-label={`New folder in ${nameOf(prefix)}`}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void makeFolder();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setCreating(false);
                }
              }}
            />
            <span>
              {sanitizeSegment(newName) === "" ? (
                "a folder name needs a letter or a number"
              ) : (
                <>
                  → <b>{`${prefix}${sanitizeSegment(newName)}/`}</b>
                </>
              )}
            </span>
            <span className="sp" />
            <Button onClick={() => void makeFolder()} disabled={sanitizeSegment(newName) === ""}>
              Create
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        ) : null}

        <div className="mdb-scope">
          <span>
            this folder · <b>{plural(files, "file", "files")}</b> · <b>{formatBytes(bytes)}</b>
            {dirs > 0 ? (
              <>
                {" · "}
                <b>{plural(dirs, "folder", "folders")}</b>
              </>
            ) : null}
            {page?.cursor ? " · more still to load" : ""}
          </span>
          {page && !page.slugStable ? (
            <>
              <span className="chip amb" title="signUploadInto refuses rather than silently renaming.">
                uploads are off here
              </span>
              {prefix === "" ? (
                <span>a loose file needs a folder — dropping a whole folder here still works</span>
              ) : (
                <Button variant="ghost" onClick={() => void makeSibling()} disabled={working}>
                  <IconFolderPlus size={12} /> make the slugged one
                </Button>
              )}
            </>
          ) : null}
          <span className="sp" />
          <span>the four tiles above count the whole library, not this folder</span>
        </div>

        <div className="msg-bar">
          <label className="msg-all">
            <input
              type="checkbox"
              checked={visible.length > 0 && visible.every((row) => picked.has(row.id))}
              onChange={(e) => setPicked(e.target.checked ? selectionOf(visible) : new Map())}
              disabled={visible.length === 0}
              aria-label="Select everything in this folder"
            />
            {count === 0 ? "nothing selected" : `${count} selected`}
            {elsewhere > 0 ? ` · ${elsewhere} in other folders` : ""}
          </label>
          {count === 0 ? (
            <span className="mdb-tray-m">
              click to select · shift-click for a run · drag onto a folder to move
            </span>
          ) : null}
          {count > 0 ? (
            <div className="msg-bulk">
              <Button variant="ghost" onClick={clear}>
                <IconX size={13} stroke={1.6} /> Clear
              </Button>
              <Button
                variant="ghost"
                onClick={() => void move(dragKeysOf(), parentOf(prefix))}
                disabled={working || prefix === "" || parentOf(prefix) === "" || dragKeysOf().length === 0}
                title="Referenced files are never moved."
              >
                <IconArrowsMove size={13} stroke={1.6} /> Move up
              </Button>
              <Button variant="destructive" onClick={beginDelete} disabled={!storage.configured}>
                <IconTrash size={13} /> Delete…
              </Button>
            </div>
          ) : null}
        </div>

        {failure && page ? (
          <div className="md-note" role="status">
            <IconAlertTriangle size={14} stroke={1.7} />
            <span>{failure} What is below is the last read that worked.</span>
            <IconButton
              style={{ marginLeft: "auto" }}
              onClick={() => void fetchPage(prefix, null)}
              disabled={loading}
              aria-label="Read this folder again"
            >
              <IconRefresh size={13} stroke={1.7} />
            </IconButton>
          </div>
        ) : null}

        {notice ? (
          <div className="md-note" role="status">
            {notice.bad ? <IconAlertTriangle size={14} stroke={1.7} /> : <IconChecks size={14} stroke={1.7} />}
            <span>{notice.text}</span>
            <IconButton
              style={{ marginLeft: "auto" }}
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
            >
              <IconX size={13} stroke={1.7} />
            </IconButton>
          </div>
        ) : null}

        <div
          className="mdb-body"
          ref={bodyRef}
          onMouseOver={(e) =>
            peekAt(
              (e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.getAttribute("data-row") ??
                null,
            )
          }
          onMouseLeave={() => peekAt(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, row: null });
          }}
          onDragEnter={(e) => {
            if (!hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            setOver(depth.current.enter());
          }}
          onDragOver={(e) => {
            if (!hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={() => setOver(depth.current.leave())}
          onDrop={(e) => {
            depth.current.reset();
            setOver(false);
            if (e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            dropInto(prefix, e);
          }}
        >
          {failure && !page ? (
            <div className="mdb-blank">
              <div className="empty">
                <div className="empty-ic">
                  <IconAlertTriangle size={18} stroke={1.5} />
                </div>
                <b>{nameOf(prefix)} could not be read</b>
                <span>{failure}</span>
                <Button variant="ghost" onClick={() => void fetchPage(prefix, null)} disabled={loading}>
                  {loading ? <IconLoader2 size={13} className="spin" /> : <IconRefresh size={13} />} Try again
                </Button>
              </div>
            </div>
          ) : !page ? (
            <div className="mdb-blank">
              <div className="empty">
                <div className="empty-ic">
                  <IconLoader2 size={18} className="spin" />
                </div>
                <b>Reading {nameOf(prefix)}</b>
                <span>R2 lists one page at a time, so a wide folder arrives in a few passes.</span>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className={cn("mdb-blank", over && "over")}>
              <div className="empty">
                <div className="empty-ic">
                  {q === "" ? <IconFolderOpen size={18} stroke={1.5} /> : <IconSearch size={18} stroke={1.5} />}
                </div>
                <b>{q === "" ? `${nameOf(prefix)} is empty` : "Nothing matches"}</b>
                <span>
                  {q === ""
                    ? prefix === ""
                      ? "Every object lives under a folder. Make one, then drop files into it."
                      : "Drop files here to upload them into this folder, or make a folder inside it."
                    : `${plural(rows.length, "item is", "items are")} here — clear the filter to see them.`}
                </span>
                {q === "" && prefix !== "" ? (
                  <Button variant="ghost" onClick={() => onPickFiles?.(prefix)} disabled={!onPickFiles}>
                    <IconCloudUpload size={13} stroke={1.6} /> Choose files
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <MediaGrid
              rows={visible}
              layout={layout}
              picked={pickedIds}
              focusId={focusId}
              dropPrefix={dropPrefix}
              dragging={dragIds}
              tapOpens={coarse}
              onPick={pick}
              onOpen={open}
              onFocusRow={setFocusId}
              onMenu={(row, x, y) => {
                if (!picked.has(row.id)) {
                  setPicked(selectionOf([row]));
                  setAnchor(row.id);
                }
                setMenu({ x, y, row });
              }}
              onDragRow={onDragRow}
              onDragDone={endDrag}
              onFolderOver={setDropPrefix}
              onFolderDrop={dropInto}
            />
          )}

          {page?.cursor ? (
            <div style={moreBar}>
              <Button
                variant="ghost"
                onClick={() => void fetchPage(prefix, page.cursor)}
                disabled={loading}
              >
                {loading ? <IconLoader2 size={13} className="spin" /> : null}
                {loading ? "Reading…" : `Load more of ${nameOf(prefix)}`}
              </Button>
            </div>
          ) : null}

          {over && dropPrefix === null && visible.length > 0 ? (
            <div className="mdb-veil">
              <b>Drop into {nameOf(prefix)}</b>
              <span>whole folders are walked · up to {MAX_DROP_FILES} files a drop</span>
            </div>
          ) : null}
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {stale ? "reading" : ""} {notice?.text ?? ""}
        </div>
      </div>

      <Inspector
        entries={chosen.entries}
        folders={chosen.folders}
        missing={chosen.missing}
        configured={storage.configured}
        onAltSaved={(key, altText) => {
          patchEntry(key, (entry) => ({ ...entry, altText }));
          onLibraryChanged?.({ altered: [{ key, altText }] });
        }}
        onAdopted={(asset) => {
          patchEntry(asset.key, (entry) => ({
            ...entry,
            assetId: asset.id,
            altText: asset.altText,
            width: asset.width,
            height: asset.height,
            blurDataUrl: asset.blurDataUrl,
            adoptable: false,
          }));
          onLibraryChanged?.({ upserted: [asset] });
          say(`“${asset.filename}” joined the library.`);
        }}
        onRemoved={(keys) => {
          dropIds(keys);
          onLibraryChanged?.({ removed: keys });
          revalidate([prefix]);
          say(`Removed ${plural(keys.length, "item", "items")}.`);
        }}
        onOpenFolder={go}
        onDeleteSelection={beginDelete}
        onClearSelection={clear}
      />

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.row ? menu.row.name : nameOf(prefix)}
          items={menuItems(menu.row)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {confirming ? (
        <DeletePlanner
          request={confirming}
          onCancel={() => setConfirming(null)}
          onFinished={finishDelete}
        />
      ) : null}

      {renaming ? (
        <Dialog
          open
          onClose={() => setRenaming(null)}
          title="Rename in the library"
          icon={IconPencil}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void rename()}
                disabled={working || renaming.value.trim() === ""}
              >
                {working ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <div className="f">
            <label htmlFor="mdb-rename">Name</label>
            <input
              id="mdb-rename"
              className="in"
              value={renaming.value}
              autoFocus
              maxLength={255}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename();
              }}
            />
            <div className="f-hint">
              This is the name the library shows. The object keeps the key it has in the bucket —
              renaming would mean copying and deleting, and every page pointing at the old URL would
              break.
            </div>
          </div>
          <div className="md-det-path">
            <code>{renaming.key}</code>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function DeletePlanner({
  request,
  onCancel,
  onFinished,
}: {
  request: DeleteRequest;
  onCancel: () => void;
  onFinished: (removed: string[], prefixes: string[], text: string, bad: boolean) => void;
}) {
  const keys = useMemo(
    () => [...request.entries.map((e) => e.key), ...request.missing.map((m) => m.key)],
    [request],
  );
  const [plans, setPlans] = useState<FolderPlan[] | null>(
    request.folders.length === 0 ? [] : null,
  );
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acc = useRef<{ removed: string[]; prefixes: string[]; notes: string[] }>({
    removed: [],
    prefixes: [],
    notes: [],
  });
  const measured = useRef(false);
  const approved = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (measured.current || request.folders.length === 0) return;
    measured.current = true;
    void (async () => {
      const out: FolderPlan[] = [];
      for (const folder of request.folders) {
        const base = { prefix: folder.prefix, name: folder.name };
        try {
          const res = await planFolderDelete({ prefix: folder.prefix });
          out.push({
            ...base,
            objects: res.objects ?? 0,
            folders: res.folders ?? 0,
            bytes: res.bytes ?? 0,
            referenced: res.referenced ?? [],
            truncated: res.truncated ?? false,
            error: res.ok ? null : (res.error ?? "That folder could not be measured."),
          });
        } catch (e) {
          out.push({
            ...base,
            objects: 0,
            folders: 0,
            bytes: 0,
            referenced: [],
            truncated: false,
            error: transportError(e),
          });
        }
      }
      setPlans(out);
    })();
  }, [request.folders]);

  const stop = () => {
    const { removed, prefixes } = acc.current;
    if (removed.length === 0 && prefixes.length === 0) {
      onCancel();
      return;
    }
    const done = [
      removed.length > 0 ? plural(removed.length, "file", "files") : "",
      prefixes.length > 0 ? plural(prefixes.length, "folder", "folders") : "",
    ].filter((part) => part !== "");
    onFinished(removed, prefixes, `Stopped part way — ${done.join(" and ")} already gone.`, false);
  };

  const run = async (force: readonly string[]) => {
    setRunning(true);
    setError(null);
    setBlocked([]);
    for (const key of force) approved.current.add(key);
    const allow = approved.current;

    try {
      const already = new Set(acc.current.removed);
      const pending = keys.filter((key) => !already.has(key));
      const held = new Map<string, string[]>();

      for (let at = 0; at < pending.length; at += DELETE_BATCH) {
        const batch = pending.slice(at, at + DELETE_BATCH);
        setStep(`Deleting ${plural(batch.length, "file", "files")}…`);
        const res = await deleteEntries({
          keys: batch,
          allowReferenced: batch.filter((key) => allow.has(key)),
        });
        acc.current.removed.push(...(res.deleted ?? []));
        const refused = res.blocked ?? [];
        for (const item of refused) held.set(item.key, item.usedIn);
        if (refused.length === 0 && !res.ok) {
          acc.current.notes.push(res.error ?? "Some of those files could not be deleted.");
          break;
        }
      }

      if (held.size > 0) {
        setBlocked([...held].map(([key, usedIn]) => ({ key, usedIn })));
        setRunning(false);
        setStep(null);
        return;
      }

      for (const folder of request.folders) {
        if (acc.current.prefixes.includes(folder.prefix)) continue;
        let passes = 0;
        let removed = 0;
        let note: string | null = null;
        let emptied = false;
        for (;;) {
          const res = await deleteFolder({
            prefix: folder.prefix,
            confirmName: (typed[folder.prefix] ?? "").trim(),
            allowReferenced: [...allow].filter((key) => key.startsWith(folder.prefix)),
          });
          const refused = res.blocked ?? [];
          if (refused.length > 0) {
            setBlocked(refused);
            setRunning(false);
            setStep(null);
            return;
          }
          const gone = res.deleted ?? 0;
          removed += gone;
          if (!res.ok) note = res.error ?? `“${folder.name}” was not emptied.`;
          if (!res.ok && gone === 0) break;
          setStep(`Emptying ${folder.name} — ${removed} gone, ${res.remaining ?? 0} to go`);
          passes += 1;
          if (res.done) {
            emptied = res.ok && (res.failed ?? []).length === 0 && (res.remaining ?? 0) === 0;
            break;
          }
          if (passes >= FOLDER_PASSES) {
            note = `“${folder.name}” is bigger than one run — open it again to clear the rest.`;
            break;
          }
        }
        if (note) acc.current.notes.push(note);
        if (emptied) acc.current.prefixes.push(folder.prefix);
      }
    } catch (e) {
      setError(transportError(e));
      setRunning(false);
      setStep(null);
      return;
    }

    const { removed, prefixes, notes } = acc.current;
    const parts: string[] = [];
    if (removed.length > 0) parts.push(`Deleted ${plural(removed.length, "file", "files")}`);
    if (prefixes.length > 0) parts.push(`emptied ${plural(prefixes.length, "folder", "folders")}`);
    onFinished(
      removed,
      prefixes,
      [parts.length > 0 ? `${parts.join(" and ")}.` : "Nothing was deleted.", ...notes].join(" "),
      notes.length > 0,
    );
  };

  const referenced = useMemo(() => {
    const found = new Map<string, string[]>();
    for (const entry of request.entries) {
      if (entry.usedIn.length > 0) found.set(entry.key, entry.usedIn);
    }
    for (const row of request.missing) {
      if (row.usedIn.length > 0) found.set(row.key, row.usedIn);
    }
    for (const plan of plans ?? []) {
      for (const item of plan.referenced) found.set(item.key, item.usedIn);
    }
    return [...found].map(([key, usedIn]) => ({ key, usedIn }));
  }, [plans, request.entries, request.missing]);

  const bytes =
    request.entries.reduce((sum, entry) => sum + entry.bytes, 0) +
    request.missing.reduce((sum, row) => sum + row.bytes, 0) +
    (plans ?? []).reduce((sum, plan) => sum + plan.bytes, 0);
  const objects =
    keys.length + (plans ?? []).reduce((sum, plan) => sum + plan.objects + plan.folders, 0);

  const named = request.folders.every((f) => (typed[f.prefix] ?? "").trim() === f.name);
  const ready = plans !== null && named && !running;

  if (blocked.length > 0) {
    return (
      <Dialog
        open
        onClose={stop}
        title="Something still points at these"
        icon={IconAlertTriangle}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={stop}>
              Keep them
            </Button>
            <Button variant="destructive" onClick={() => void run(blocked.map((b) => b.key))}>
              <IconTrash size={13} /> Delete anyway
            </Button>
          </>
        }
      >
        <p style={{ color: "var(--dim)", fontSize: 13.5, lineHeight: 1.65 }}>
          Nothing in this list has been deleted. Each key below is still written into a project, a
          blog, an experience or a site setting, and deleting it leaves that page pointing at a 404.
        </p>
        <BlockedList items={blocked} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={running ? () => undefined : stop}
      title={
        request.folders.length > 0
          ? `Delete ${plural(request.folders.length, "folder", "folders")} and everything inside`
          : `Delete ${plural(keys.length, "file", "files")}`
      }
      icon={IconTrash}
      wide
      footer={
        <>
          {step ? <span className="mdb-tray-m">{step}</span> : null}
          <Button variant="ghost" onClick={stop} disabled={running}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void run([])} disabled={!ready}>
            <IconTrash size={13} />
            {running ? "Deleting…" : plans === null ? "Measuring…" : "Delete"}
          </Button>
        </>
      }
    >
      <div className="md-det">
        <div className="mdb-side-sum">
          <div>
            {plans === null ? "counting…" : plural(objects, "object", "objects")} ·{" "}
            {plans === null ? "…" : formatBytes(bytes)}
          </div>
          <div>R2 has no versioning, so there is no undo and no trash to fish it back out of.</div>
        </div>

        {keys.length > 0 ? (
          <div>
            <div className="md-det-k">files</div>
            <div className="mdb-blocked">
              {request.entries.map((entry) => (
                <div key={entry.key}>
                  <b>{entry.key}</b>
                  <span>
                    {formatBytes(entry.bytes)}
                    {entry.assetId === null ? " · not in library" : ""}
                  </span>
                </div>
              ))}
              {request.missing.map((row) => (
                <div key={row.key}>
                  <b>{row.key}</b>
                  <span>row only, the object is already gone</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {plans === null ? (
          <div className="md-det-none">
            <IconLoader2 size={13} className="spin" /> Walking the subtree to count what is in there.
          </div>
        ) : null}

        {(plans ?? []).map((plan) => (
          <div key={plan.prefix}>
            <div className="md-det-k">{plan.prefix}</div>
            {plan.error ? (
              <div className="rv-err">{plan.error}</div>
            ) : (
              <div className="mdb-side-sum">
                <div>
                  {plural(plan.objects, "object", "objects")} ·{" "}
                  {plural(plan.folders, "sub-folder", "sub-folders")} · {formatBytes(plan.bytes)}
                </div>
                {plan.truncated ? (
                  <div>counted to the walk limit — the real total is larger, and it deletes in passes</div>
                ) : null}
              </div>
            )}
            <div className="f" style={{ marginTop: 10 }}>
              <label htmlFor={`mdb-say-${plan.prefix}`}>
                type {plan.name} to confirm
              </label>
              <input
                id={`mdb-say-${plan.prefix}`}
                className="in mono"
                value={typed[plan.prefix] ?? ""}
                placeholder={plan.name}
                autoComplete="off"
                spellCheck={false}
                disabled={running}
                onChange={(e) => setTyped((prev) => ({ ...prev, [plan.prefix]: e.target.value }))}
              />
            </div>
          </div>
        ))}

        {referenced.length > 0 ? (
          <div>
            <div className="md-det-k">pages that break</div>
            <BlockedList items={referenced} />
            <div className="md-det-none">
              The server refuses these on its own and hands the list back, so the delete will stop
              and ask again rather than quietly breaking them.
            </div>
          </div>
        ) : (
          <div className="md-det-none">
            Nothing found pointing at any of this. The scan reads project logos and images, blog
            covers and bodies, experience logos and every site setting — a file reached some other
            way would look the same here, so check before deleting.
          </div>
        )}

        {error ? <div className="rv-err">{error}</div> : null}
      </div>
    </Dialog>
  );
}
