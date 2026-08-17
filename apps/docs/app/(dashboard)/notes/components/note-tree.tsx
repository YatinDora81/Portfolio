"use client";

import {
  Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconArrowsMove,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDotsVertical,
  IconFilePlus,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFoldUp,
  IconHelpCircle,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  createNode, duplicateNode, moveNode, nudgeNode, renameNode, restoreNode, trashNode,
} from "@/lib/actions/notes";
import { ancestorPaths, moveError } from "@/lib/notes/paths";
import {
  highlightParts, isEmptyQuery, matchFolder, matchQuestion, parseQuery, terms,
  type ParsedQuery,
} from "@/lib/notes/query";
import type { VaultItem } from "@/lib/notes/vault-view";
import { hrefFor, NOTES_ROOT, notePathOf, type NoteKind } from "@/lib/notes/view-types";
import { cn } from "@/lib/utils";
import { ImportButton } from "./import-dialog";
import { TreeMenu, type MenuTarget } from "./tree-menu";
import { useNoteNav, useVault } from "./vault-provider";

/**
 * The vault's spine: a real ARIA tree, the whole APG keyboard contract, a local
 * filter and a keyboard-only move mode.
 *
 * It renders from the vault the layout loaded and holds no copy of it. Expanded
 * folders, keyboard focus and the filter string are the only client state here;
 * everything about the vault itself is the server's, re-read after each action
 * through `touched()`. That is what lets a rename land in the sidebar, the
 * breadcrumb and the folder overview at once without a store to keep in sync —
 * the three of them are reading the same object.
 *
 * Which is also why the filter can now answer `tag:`, `conf:`, `is:` and `has:`
 * without leaving the browser: that same object carries the answers.
 *
 * The one rule the rest of the file answers to: a half-built `role="tree"` is an
 * accessibility regression, not a step towards one. Announcing levels and
 * positions while ↑ and ↓ do nothing leaves a screen-reader user stranded
 * somewhere a plain list of links would not have. So every key below is wired,
 * or the role comes off.
 */

/** One row, flattened once so lookups and the keyboard never walk the tree. */
interface Flat {
  node: VaultItem;
  /** 1-based, and set explicitly on the element — see the render. */
  level: number;
  pos: number;
  size: number;
  parentId: string | null;
  /** Folder titles above this row, root first. `in:redis` reads these. */
  ancestorTitles: string[];
}

interface Toast {
  id: number;
  msg: string;
  tone: "good" | "bad";
  undo?: () => void;
}

let toastSeq = 0;

/** Both action result shapes, so one runner can drive every write below. */
type Res = { ok: true } | { ok: true; id: string; path: string } | { ok: false; error: string };

const DEFERRED_HINT = "needs the full search";

const EMPTY: ReadonlySet<string> = new Set();

function indexByPath(list: VaultItem[], into = new Map<string, VaultItem>()) {
  for (const n of list) {
    into.set(n.path, n);
    indexByPath(n.children, into);
  }
  return into;
}

/** Every folder above `path`, plus `path` itself when it is one. */
function revealSet(tree: VaultItem[], path: string): Set<string> {
  const byPath = indexByPath(tree);
  const out = new Set<string>();
  for (const p of ancestorPaths(path)) {
    const n = byPath.get(p);
    if (n?.kind === "FOLDER") out.add(n.id);
  }
  return out;
}

const countBelow = (n: VaultItem): number =>
  n.children.reduce((a, c) => a + 1 + countBelow(c), 0);

export function NoteTree() {
  // Straight off the layout's one payload rather than through props: the reading
  // pane is looking at the same object, so a title cannot be current in one and
  // stale in the other. `vaultEmpty` gates the `restore` mode in the import
  // dialog, which only an entirely empty vault — trashed rows included — accepts.
  const { tree, trashCount, vaultEmpty, byPath } = useVault();
  const router = useRouter();
  const pathname = usePathname();
  const go = useNoteNav();
  const [pending, startTransition] = useTransition();

  /**
   * The note's own path, carved off the URL. `/notes` *is* the vault root and a
   * note's path is its URL beneath it, so no lookup is needed in either
   * direction — and the sibling routes (/notes/search, /notes/trash) resolve to
   * null, which is a path nothing in the tree holds.
   */
  const activePath = useMemo(() => notePathOf(pathname) ?? "", [pathname]);

  const [expanded, setExpanded] = useState<Set<string>>(() => revealSet(tree, activePath));
  const [filter, setFilter] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null; kind: NoteKind } | null>(null);
  const [grab, setGrab] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [notice, setNotice] = useState("");

  const treeRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* ---------- flat index ---------- */

  const flat = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: VaultItem[], level: number, parentId: string | null, titles: string[]) => {
      list.forEach((node, i) => {
        out.push({ node, level, pos: i + 1, size: list.length, parentId, ancestorTitles: titles });
        if (node.children.length) walk(node.children, level + 1, node.id, [...titles, node.title]);
      });
    };
    walk(tree, 1, null, []);
    return out;
  }, [tree]);

  // `byId` maps to the flattened record the keyboard walks, so it stays local.
  // `byPath` is the vault's own index — a second one built from a different
  // structure is a second thing that can be wrong.
  const byId = useMemo(() => new Map(flat.map((f) => [f.node.id, f])), [flat]);
  const selectedId = byPath.get(activePath)?.id ?? null;

  /* ---------- filter ---------- */

  const parsed = useMemo(() => parseQuery(filter), [filter]);

  /**
   * The half of the query language this box cannot honestly answer.
   *
   * The sidebar's query never selects an answer body, which is exactly why
   * moving between notes costs one small query however large the vault gets. So
   * `tag:redis` evaluated here would be run against an empty tag list and
   * confidently report nothing — and a search that returns zero when the answer
   * exists is what teaches someone that search is broken. These terms are
   * lifted out of the local match, named under the box, and handed to
   * /notes/search, which has the columns to answer them.
   */
  const deferred = useMemo(
    () => [
      ...parsed.tags.map((t) => `tag:${t}`),
      ...parsed.notTags.map((t) => `-tag:${t}`),
      ...parsed.is.map((x) => `is:${x}`),
      ...parsed.notIs.map((x) => `-is:${x}`),
      ...parsed.conf.map((c) => `conf:${c.op === "=" ? "" : c.op}${c.v}`),
      ...parsed.has.map((h) => `has:${h}`),
    ],
    [parsed]
  );

  const local = useMemo<ParsedQuery>(
    () => ({ ...parsed, tags: [], notTags: [], is: [], notIs: [], conf: [], has: [] }),
    [parsed]
  );

  const typing = filter.trim().length > 0;
  const filtering = typing && !isEmptyQuery(local);
  const hits = useMemo(() => (filtering ? terms(local) : []), [filtering, local]);

  const { hidden, ancestral, matches } = useMemo(() => {
    if (!filtering) return { hidden: EMPTY, ancestral: EMPTY, matches: 0 };
    const keep = new Set<string>();
    const hit = new Set<string>();
    for (const f of flat) {
      const n = f.node;
      const ok =
        n.kind === "QUESTION"
          ? matchQuestion(
              {
                title: n.title,
                path: n.path,
                deletedAt: null,
                body: "",
                tags: [],
                confidence: 0,
                lastRevisedAt: null,
                ancestorTitles: f.ancestorTitles,
              },
              local
            )
          : matchFolder({ title: n.title, deletedAt: null }, local);
      if (!ok) continue;
      hit.add(n.id);
      // Never hide a parent to show a child: a match that appears detached from
      // its branch costs more than the rows it saved.
      for (const p of ancestorPaths(n.path)) {
        const a = byPath.get(p);
        if (a) keep.add(a.id);
      }
    }
    const hid = new Set<string>();
    const anc = new Set<string>();
    for (const f of flat) {
      if (!keep.has(f.node.id)) hid.add(f.node.id);
      else if (!hit.has(f.node.id)) anc.add(f.node.id);
    }
    return { hidden: hid as ReadonlySet<string>, ancestral: anc as ReadonlySet<string>, matches: hit.size };
  }, [filtering, flat, local, byPath]);

  /**
   * The children of a folder that survived the filter. Identity-stable when
   * nothing is filtered, which is the case on every render that is not a
   * keystroke in the filter box — the whole tree calls this per node.
   */
  const shownKids = useCallback(
    (node: VaultItem) => (hidden.size ? node.children.filter((c) => !hidden.has(c.id)) : node.children),
    [hidden]
  );

  /**
   * A folder holding a surviving child opens itself while the filter runs —
   * otherwise the one row the user is looking for sits inside a collapsed
   * branch and the filter reads as "no results". Collapsing it back is refused
   * for the same reason, which is why this is named rather than folded into
   * `openOf`: ← has to walk to the parent on a folder it cannot close, instead
   * of becoming a dead key.
   */
  const heldOpen = useCallback(
    (node: VaultItem) => filtering && shownKids(node).length > 0,
    [filtering, shownKids]
  );

  const openOf = useCallback(
    (node: VaultItem) => {
      if (node.kind !== "FOLDER" || !shownKids(node).length) return false;
      return expanded.has(node.id) || heldOpen(node);
    },
    [expanded, heldOpen, shownKids]
  );

  /** Rows the arrow keys may land on, in the order they appear on screen. */
  const visible = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: VaultItem[]) => {
      for (const node of list) {
        if (hidden.has(node.id)) continue;
        const f = byId.get(node.id);
        if (f) out.push(f);
        if (openOf(node)) walk(node.children);
      }
    };
    walk(tree);
    return out;
  }, [tree, hidden, byId, openOf]);

  /**
   * Exactly one row is a tab stop and it travels with focus. Without it Tab
   * walks every node in the vault before it reaches the reader. It falls back
   * to the first visible row whenever the focused one is trashed, renamed out
   * from under the filter, or never existed.
   */
  const rovingId = useMemo(() => {
    if (focusId && visible.some((v) => v.node.id === focusId)) return focusId;
    return visible[0]?.node.id ?? null;
  }, [focusId, visible]);

  /* ---------- focus ---------- */

  const focusRow = useCallback((id: string | null | undefined) => {
    if (!id) return;
    setFocusId(id);
    setFocusTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!focusTick || !focusId) return;
    // An inline input and the row menu hold the keyboard legitimately. Pulling
    // focus back to the row would close a rename the same frame it opened, or
    // drop the caret out of a menu that has only just been summoned.
    if (renaming || creating || menu) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-nid="${CSS.escape(focusId)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    // Those three are read, not depended on: this fires on a focus *request*,
    // not every time an input or a menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, focusId]);

  /* ---------- server actions ---------- */

  const showToast = useCallback((msg: string, tone: "good" | "bad", undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ id: ++toastSeq, msg, tone, undo });
    // An undo has to outlast the moment of realising it is needed.
    toastTimer.current = setTimeout(() => setToast(null), undo ? 9000 : 4000);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const run = useCallback(
    <R extends Res>(fn: () => Promise<R>, after?: (res: Extract<R, { ok: true }>) => void) => {
      startTransition(async () => {
        const res = await fn();
        if (!res.ok) {
          // Never swallowed: a refusal the user cannot see is a tree that
          // silently disagrees with the database.
          setNotice(res.error);
          showToast(res.error, "bad");
          return;
        }
        after?.(res as Extract<R, { ok: true }>);
      });
    },
    [showToast]
  );

  /* A rename or a move rewrites `path` while the browser is still parked on the
     old URL. That used to be followed from here, with a latch and a `!pending`
     race; note-pane.tsx re-finds the open note by id and corrects the address
     itself now, which also covers a rename from the editor or the action row.
     Two mechanisms chasing the same note is one more than can be kept in
     agreement. */

  /* ---------- expand ---------- */

  const toggle = useCallback((id: string, want?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (want === undefined ? next.has(id) : !want) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Open every folder above `path`, touching nothing else. */
  const revealPath = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        let grew = false;
        for (const p of ancestorPaths(path)) {
          const n = byPath.get(p);
          if (n?.kind === "FOLDER" && !next.has(n.id)) {
            next.add(n.id);
            grew = true;
          }
        }
        return grew ? next : prev;
      });
    },
    [byPath]
  );

  // Arriving at a deep note from search, the palette or a bookmark has to reveal
  // it. Additive on purpose — a navigation opens folders, it never closes one
  // the user opened by hand.
  useEffect(() => {
    revealPath(activePath);
  }, [activePath, revealPath]);

  /**
   * The other half of the reader's "reveal in tree" button.
   *
   * The effect above only fires when `activePath` changes, so a folder the user
   * collapsed *after* arriving stays collapsed and the button's scrollIntoView
   * aims at a row that is no longer mounted. The tree lives in the layout and
   * the reader in the page, with no prop between them — an event on `window` is
   * the seam. It re-runs the same reveal for the path it is handed, which is
   * why pressing the button twice is idempotent rather than cumulative.
   */
  useEffect(() => {
    const onReveal = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (path) revealPath(path);
    };
    window.addEventListener("notes:reveal", onReveal);
    return () => window.removeEventListener("notes:reveal", onReveal);
  }, [revealPath]);

  /* ---------- move mode ---------- */

  /**
   * Where the grabbed row would land if it were dropped now. Derived rather
   * than stored, so the live region, the amber bar and the `moveNode` call can
   * never describe three different destinations.
   */
  const moveInfo = useMemo(() => {
    if (!grab) return null;
    const node = byId.get(grab)?.node;
    if (!node) return null;
    const cursor = over ? byId.get(over) : null;

    // Landing on a folder means "inside it"; landing on a question means
    // "alongside it", which is the only reading that lets one gesture express
    // both without a modifier.
    const destId =
      !cursor || cursor.node.id === grab
        ? (byId.get(grab)?.parentId ?? null)
        : cursor.node.kind === "FOLDER"
          ? cursor.node.id
          : cursor.parentId;

    const dest = destId ? (byId.get(destId)?.node ?? null) : null;
    const err = moveError(node, dest ? { id: dest.id, path: dest.path, kind: dest.kind } : null);

    const siblings = dest ? dest.children : tree;
    const others = siblings.filter((c) => c.id !== grab);
    let index: number;
    if (cursor && cursor.node.id === grab) index = Math.min(siblings.findIndex((c) => c.id === grab), others.length);
    else if (cursor && cursor.node.id !== destId) index = others.findIndex((s) => s.id === cursor.node.id);
    else index = others.length;
    if (index < 0) index = others.length;

    return { node, dest, destId, err, index, total: others.length + 1 };
  }, [grab, over, byId, tree]);

  const moveText = moveInfo
    ? moveInfo.err
      ? `Cannot drop here — ${moveInfo.err}. Escape to cancel.`
      : `Moving “${moveInfo.node.title}” to ${moveInfo.dest ? moveInfo.dest.title : "the vault root"}, ` +
        `position ${moveInfo.index + 1} of ${moveInfo.total}. Space to drop, Escape to cancel.`
    : "";

  const startMove = (id: string) => {
    setMenu(null);
    setRenaming(null);
    setCreating(null);
    setGrab(id);
    setOver(id);
    focusRow(id);
  };

  const endMove = (commit: boolean) => {
    const info = moveInfo;
    const id = grab;
    if (!id) return;
    if (commit && info && info.err) return; // the live region already says why
    setGrab(null);
    setOver(null);
    if (!commit || !info) {
      setNotice("Move cancelled.");
      focusRow(id);
      return;
    }
    const { destId, dest, index, node } = info;
    run(
      () => moveNode(id, destId, index),
      () => {
        if (destId) setExpanded((p) => new Set(p).add(destId));
        setNotice(`“${node.title}” moved to ${dest ? dest.title : "the vault root"}.`);
        // The whole point of the drop: the row the user was holding is still
        // the row under their fingers, at its new address.
        focusRow(id);
      }
    );
  };

  /* ---------- row actions ---------- */

  const beginCreate = (parentId: string | null, kind: NoteKind) => {
    setMenu(null);
    setRenaming(null);
    setGrab(null);
    // A new row cannot be typed into a branch the filter is hiding, and the
    // filter would reject the empty title anyway.
    setFilter("");
    if (parentId) setExpanded((p) => new Set(p).add(parentId));
    setCreating({ parentId, kind });
  };

  const commitCreate = (title: string) => {
    const c = creating;
    setCreating(null);
    if (!c || !title) return;
    run(
      () => createNode(c.parentId, c.kind, title),
      (res) => {
        setNotice(`${c.kind === "FOLDER" ? "Folder" : "Question"} “${title}” created.`);
        go(hrefFor(res.path), { afterWrite: true });
        focusRow(res.id);
      }
    );
  };

  const commitRename = (id: string, title: string) => {
    setRenaming(null);
    const before = byId.get(id)?.node.title;
    if (!title || title === before) {
      focusRow(id);
      return;
    }
    run(
      () => renameNode(id, title),
      () => {
        setNotice(`Renamed to “${title}”.`);
        focusRow(id);
      }
    );
  };

  const doNudge = (id: string, dir: -1 | 1) => {
    run(
      () => nudgeNode(id, dir),
      () => {
        setNotice(`Moved ${dir < 0 ? "up" : "down"}.`);
        focusRow(id);
      }
    );
  };

  const doDuplicate = (id: string) => {
    const title = byId.get(id)?.node.title ?? "note";
    run(
      () => duplicateNode(id),
      (res) => {
        showToast(`“${title}” duplicated`, "good");
        go(hrefFor(res.path), { afterWrite: true });
      }
    );
  };

  const doTrash = (id: string) => {
    const f = byId.get(id);
    if (!f) return;
    const { node } = f;
    const inside = countBelow(node);
    const i = visible.findIndex((v) => v.node.id === id);
    // The next row that is not inside the subtree about to disappear.
    const nextFocus =
      visible.slice(i + 1).find((v) => !v.node.path.startsWith(`${node.path}/`))?.node.id ??
      visible[i - 1]?.node.id ??
      null;
    const wasOpen = activePath === node.path || activePath.startsWith(`${node.path}/`);

    run(
      () => trashNode(id),
      () => {
        setNotice(`“${node.title}” moved to trash.`);
        showToast(
          `“${node.title}” moved to trash${inside ? ` with ${inside} item${inside === 1 ? "" : "s"}` : ""}`,
          "good",
          () =>
            run(
              () => restoreNode(id),
              () => {
                showToast(`“${node.title}” restored`, "good");
                focusRow(id);
              }
            )
        );
        // The reader is showing a note that no longer resolves; leaving it there
        // would turn the next render into a 404 on a note the user can restore.
        if (wasOpen) go(NOTES_ROOT, { afterWrite: true });
        focusRow(nextFocus);
      }
    );
  };

  const openMenu = (node: VaultItem, x: number, y: number) => {
    setGrab(null);
    setMenu({ id: node.id, title: node.title, kind: node.kind, x, y });
  };

  const closeMenu = () => {
    const id = menu?.id;
    setMenu(null);
    focusRow(id);
  };

  /* ---------- keyboard ---------- */

  const typeAhead = useRef({ buf: "", at: 0 });

  const seek = (key: string, from: number): string | undefined => {
    const now = Date.now();
    const ta = typeAhead.current;
    ta.buf = now - ta.at > 700 ? key : ta.buf + key;
    ta.at = now;
    const needle = ta.buf.toLowerCase();
    // A repeated single letter walks successive matches; a longer run refines
    // in place, which is why the multi-character search includes the current
    // row and the single-character one does not.
    const start = needle.length > 1 ? from : from + 1;
    const order = [...visible.slice(start), ...visible.slice(0, start)];
    const found = order.find((v) => v.node.title.toLowerCase().startsWith(needle));
    if (found) return found.node.id;
    if (needle.length === 1) return undefined;
    // The run matched nothing — treat the keystroke as the start of a new one
    // rather than as a dead key.
    ta.buf = key;
    const fresh = [...visible.slice(from + 1), ...visible.slice(0, from + 1)];
    return fresh.find((v) => v.node.title.toLowerCase().startsWith(key.toLowerCase()))?.node.id;
  };

  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-nid]");
    const id = el?.dataset.nid;
    const f = id ? byId.get(id) : undefined;
    if (!f || !id) return;
    const { node } = f;
    const i = visible.findIndex((v) => v.node.id === id);

    if (grab) {
      // Anything the browser owns stays the browser's; everything else belongs
      // to the move. The `stopPropagation` is the load-bearing half — "/" and
      // ⌘K are listened for on `window`, and either one firing mid-move would
      // take the caret away and leave a row grabbed with no way to see it.
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { endMove(false); return; }
      if (e.key === " " || e.key === "Enter") { endMove(true); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const t = visible[i + (e.key === "ArrowDown" ? 1 : -1)];
        if (t) { setOver(t.node.id); focusRow(t.node.id); }
      }
      return;
    }

    // ⌥↑ / ⌥↓ reorder rather than navigate, so they are read before the arrows.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      doNudge(id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(visible[i + 1]?.node.id);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(visible[i - 1]?.node.id);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (node.kind !== "FOLDER" || !shownKids(node).length) break;
        if (!openOf(node)) toggle(node.id, true);
        else focusRow(visible[i + 1]?.node.id);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (openOf(node) && !heldOpen(node)) toggle(node.id, false);
        else focusRow(f.parentId);
        break;
      case "Home":
        e.preventDefault();
        focusRow(visible[0]?.node.id);
        break;
      case "End":
        e.preventDefault();
        focusRow(visible[visible.length - 1]?.node.id);
        break;
      case "Enter":
        e.preventDefault();
        if (node.kind === "FOLDER") toggle(node.id, true);
        go(hrefFor(node.path));
        break;
      case " ":
        e.preventDefault();
        startMove(id);
        break;
      case "*":
        e.preventDefault();
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const s of f.parentId ? (byId.get(f.parentId)?.node.children ?? []) : tree) {
            if (s.kind === "FOLDER" && s.children.length) next.add(s.id);
          }
          return next;
        });
        break;
      case "F2":
        e.preventDefault();
        setRenaming(id);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        doTrash(id);
        break;
      case "ContextMenu": {
        e.preventDefault();
        const r = el!.getBoundingClientRect();
        openMenu(node, r.left + 28, r.bottom);
        break;
      }
      default: {
        // Shift+F10 is the other half of the platform's menu key, and it is the
        // only way to the row menu for a keyboard that has no ContextMenu key.
        if (e.key === "F10" && e.shiftKey) {
          e.preventDefault();
          const r = el!.getBoundingClientRect();
          openMenu(node, r.left + 28, r.bottom);
          break;
        }
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey || !/\S/.test(e.key)) break;
        const hit = seek(e.key, i);
        if (hit) {
          e.preventDefault();
          focusRow(hit);
        }
      }
    }
  };

  // "/" from anywhere in the page, which is where the hand goes first and where
  // the tree is most often the wrong place to be looking.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // A modal owns the keyboard while it is up. Without this, "/" pressed in
      // the import dialog — before the caret has been put in the textarea —
      // moves focus to a filter box behind the veil, where the typing that
      // follows is invisible and Escape closes the dialog and the paste with it.
      // Same guard as the command palette (shell.tsx) and the revise deck.
      if (t?.closest(".modal") || document.querySelector(".veil")) return;
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const goSearch = (q: string) =>
    router.push(`${NOTES_ROOT}/search?q=${encodeURIComponent(q.trim())}`);

  /* ---------- count line ---------- */

  const lines: { text: string; bad?: boolean }[] = [];
  if (typing) {
    if (parsed.bad.length) lines.push({ text: `unknown: ${parsed.bad.join(", ")}`, bad: true });
    if (filtering) {
      lines.push({
        text: matches
          ? `${matches} match${matches === 1 ? "" : "es"} · ancestors kept`
          : "no matching titles",
      });
    }
    if (deferred.length) lines.push({ text: `${deferred.join(" ")} ${DEFERRED_HINT}` });
  }
  const summary = lines.map((l) => l.text).join(" · ");

  // The count is the filter's only feedback, and feedback nobody can hear is a
  // filter a screen-reader user has to guess at. Debounced rather than made a
  // live region of its own: per keystroke it would talk over itself, and over
  // move mode, which shares this region.
  useEffect(() => {
    if (!summary) return;
    const t = setTimeout(() => setNotice(summary), 400);
    return () => clearTimeout(t);
  }, [summary]);

  /* ---------- render ---------- */

  const label = (node: VaultItem) => {
    if (!hits.length) return node.title;
    return highlightParts(node.title, hits).map((p, k) =>
      p.hit ? <span key={k} className="nt-hit">{p.text}</span> : <Fragment key={k}>{p.text}</Fragment>
    );
  };

  const ariaLabel = (node: VaultItem) =>
    node.kind === "FOLDER"
      ? `${node.title}, folder${node.questions ? `, ${node.questions} question${node.questions === 1 ? "" : "s"}` : ""}`
      : node.title;

  /**
   * `shown`, not `list`: a row the filter removed is not rendered at all, so it
   * must not be counted either. `aria-setsize` describing five siblings while
   * one is present is the kind of half-truth that makes a screen reader's
   * running commentary useless — the numbers have to describe the tree the
   * arrow keys can actually reach.
   */
  const renderChildren = (list: VaultItem[], level: number, parentId: string | null): React.ReactNode => {
    const shown = hidden.size ? list.filter((n) => !hidden.has(n.id)) : list;
    return (
      <>
        {shown.map((node, i) => renderNode(node, level, i + 1, shown.length))}
        {creating && creating.parentId === parentId ? (
          <InlineInput
            key="new"
            kind={creating.kind}
            onCommit={commitCreate}
            onCancel={() => setCreating(null)}
          />
        ) : null}
      </>
    );
  };

  const renderNode = (
    node: VaultItem,
    level: number,
    pos: number,
    size: number
  ): React.ReactNode => {
    const folder = node.kind === "FOLDER";
    const kids = folder ? shownKids(node) : [];
    const open = openOf(node);
    const adopting = creating?.parentId === node.id;
    const showGroup = folder && (adopting || (open && kids.length > 0));
    const Twisty = open ? IconChevronDown : IconChevronRight;
    const FolderIcon = open ? IconFolderOpen : IconFolder;

    return (
      <div
        key={node.id}
        data-nid={node.id}
        role="treeitem"
        // Explicit, all three: browsers are permitted to compute them from the
        // DOM and several AT combinations simply do not.
        aria-level={level}
        aria-posinset={pos}
        aria-setsize={size}
        aria-selected={node.id === selectedId}
        aria-expanded={folder && kids.length ? open : undefined}
        // Named here rather than left to name-from-content: the row also holds a
        // count badge and a labelled kebab, and on a `treeitem` the computation
        // can reach into the group beneath it.
        aria-label={ariaLabel(node)}
        tabIndex={node.id === rovingId ? 0 : -1}
        className={cn(
          "nt-item",
          node.id === selectedId && "sel",
          node.id === rovingId && "kfoc",
          ancestral.has(node.id) && "anc",
          grab === node.id && "grab",
          moveInfo && !moveInfo.err && moveInfo.destId === node.id && "drop"
        )}
        onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(node.id); }}
      >
        {renaming === node.id ? (
          <InlineInput
            kind={node.kind}
            initial={node.title}
            onCommit={(v) => commitRename(node.id, v)}
            onCancel={() => { setRenaming(null); focusRow(node.id); }}
          />
        ) : (
          <div
            className="nt-row"
            onClick={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("[data-gr]")) return;
              if (grab) return;
              focusRow(node.id);
              if (folder && kids.length && t.closest("[data-tw]")) {
                toggle(node.id);
                return;
              }
              go(hrefFor(node.path));
            }}
            // `setFocusId`, not `focusRow`: the roving tabindex has to land on
            // this row so closing the menu returns here, but the menu is about
            // to take the caret and a queued row focus would race it away.
            onContextMenu={(e) => {
              e.preventDefault();
              setFocusId(node.id);
              openMenu(node, e.clientX, e.clientY);
            }}
          >
            <span className="nt-tw" data-tw aria-hidden="true">
              {folder && kids.length ? <Twisty size={11} /> : null}
            </span>
            <span className="nt-ic" aria-hidden="true">
              {folder ? <FolderIcon size={14} /> : <IconHelpCircle size={14} />}
            </span>
            <span className="nt-tx">{label(node)}</span>
            {folder && !open && node.questions ? (
              <span className="nt-n" aria-hidden="true">{node.questions}</span>
            ) : null}
            {/* A mouse affordance for a menu the keyboard reaches with its own
                menu key, so it stays out of the tab order the roving tabindex
                owns — two hundred grips would be two hundred tab stops. */}
            <button
              type="button"
              data-gr
              className="nt-gr"
              tabIndex={-1}
              aria-label={`Actions for ${node.title}`}
              onClick={(e) => {
                e.stopPropagation();
                setFocusId(node.id);
                const r = e.currentTarget.getBoundingClientRect();
                openMenu(node, r.left, r.bottom + 2);
              }}
            >
              <IconDotsVertical size={13} />
            </button>
          </div>
        )}
        {showGroup ? (
          <div role="group" className="nt-group">
            {renderChildren(node.children, level + 1, node.id)}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="nt-tp">
      <div className="nt-tp-head">
        <span className="nt-tp-eyebrow">{pending ? "working…" : "vault"}</span>
        <button
          type="button"
          className="nt-iconbtn"
          title="New question at the root"
          aria-label="New question at the root"
          onClick={() => beginCreate(null, "QUESTION")}
        >
          <IconFilePlus size={15} />
        </button>
        <button
          type="button"
          className="nt-iconbtn"
          title="New folder at the root"
          aria-label="New folder at the root"
          onClick={() => beginCreate(null, "FOLDER")}
        >
          <IconFolderPlus size={15} />
        </button>
        {/* Beside the two create buttons because it is the third way a note
            gets into the vault, and the only one that can make more than one. */}
        <ImportButton parentId={null} canRestore={vaultEmpty} variant="icon" />
        <button
          type="button"
          className="nt-iconbtn"
          title="Collapse every open folder"
          aria-label="Collapse all folders"
          onClick={() => setExpanded(new Set())}
        >
          <IconFoldUp size={15} />
        </button>
      </div>

      {/* The whole box is the target, not just the 190px of input inside it —
          clicking the icon or the padding used to land on nothing. */}
      <div
        className={cn("nt-filter", filter && "on")}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          filterRef.current?.focus();
        }}
      >
        <IconSearch size={12} aria-hidden="true" />
        <input
          ref={filterRef}
          type="search"
          value={filter}
          placeholder="Filter · tag:graphs"
          aria-label="Filter notes"
          aria-describedby="nt-filter-count"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goSearch(filter);
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (filter) setFilter("");
              else filterRef.current?.blur();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              focusRow(visible[0]?.node.id);
            }
          }}
        />
        {/* The `/` hint has done its job once there is something in the box;
            what you want then is the way out, and Escape is not discoverable. */}
        {filter ? (
          <button
            type="button"
            className="nt-filter-x"
            title="Clear the filter · Esc"
            aria-label="Clear the filter"
            onClick={() => {
              setFilter("");
              filterRef.current?.focus();
            }}
          >
            <IconX size={13} stroke={2} />
          </button>
        ) : (
          <span className="kbd" aria-hidden="true">/</span>
        )}
      </div>

      <div className="nt-count" id="nt-filter-count">
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i ? " · " : null}
            {l.bad ? <span className="nt-bad">{l.text}</span> : l.text}
          </Fragment>
        ))}
        {lines.length ? (
          <>
            {" · "}
            <button type="button" onClick={() => goSearch(filter)}>see all →</button>
          </>
        ) : null}
      </div>

      <div className="nt-scroll">
        {tree.length || creating ? (
          <div
            ref={treeRef}
            className="nt-tree"
            role="tree"
            aria-label="Notes and folders"
            aria-busy={pending}
            onKeyDown={onTreeKeyDown}
          >
            {renderChildren(tree, 1, null)}
          </div>
        ) : (
          <div className="nt-empty">
            Nothing here yet.
            <br />
            Start with a folder for a topic.
          </div>
        )}
      </div>

      <div className="nt-foot">
        <Link
          className="btn ghost"
          href={`${NOTES_ROOT}/trash`}
          aria-current={pathname === `${NOTES_ROOT}/trash` ? "page" : undefined}
        >
          <IconTrash size={14} />
          Trash
          {trashCount ? <span className="nt-n">{trashCount}</span> : null}
        </Link>
      </div>

      {menu ? (
        <TreeMenu
          target={menu}
          onClose={closeMenu}
          onNew={(kind) => beginCreate(menu.id, kind)}
          onRename={() => setRenaming(menu.id)}
          onMove={() => startMove(menu.id)}
          onNudge={(dir) => doNudge(menu.id, dir)}
          onDuplicate={() => doDuplicate(menu.id)}
          onTrash={() => doTrash(menu.id)}
        />
      ) : null}

      {moveInfo ? (
        <div className="nt-live">
          <IconArrowsMove size={14} />
          <span>{moveText}</span>
        </div>
      ) : null}

      {toast ? (
        <div className="toasts">
          <div className={cn("toast", toast.tone === "bad" && "bad")}>
            {toast.tone === "bad" ? (
              <IconAlertTriangle size={15} className="tic" />
            ) : (
              <IconCircleCheck size={15} className="tic" />
            )}
            {toast.msg}
            {toast.undo ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  const fn = toast.undo!;
                  setToast(null);
                  fn();
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Move mode is a mode, and a mode with no running commentary is a mode a
          screen-reader user is trapped in. Every arrow press rewrites this. */}
      <div role="status" aria-live="polite" className="sr-only">
        {moveInfo ? moveText : notice}
      </div>
    </div>
  );
}

/**
 * Create and rename happen in the tree, at the row's own indent, because the
 * name being typed is only meaningful next to its siblings — a modal asking for
 * a title hides the six titles that would tell you what to type.
 *
 * Blur commits rather than cancels: clicking away from a name you have finished
 * typing means you are finished typing it, and Escape is right there for the
 * other reading. The `done` latch is what keeps Enter-then-unmount from
 * committing twice.
 */
function InlineInput({
  kind, initial = "", onCommit, onCancel,
}: {
  kind: NoteKind;
  initial?: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const question = kind === "QUESTION";

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value.trim() ?? "");
    else onCancel();
  };

  return (
    <div className="nt-inline" role="none">
      <span className="nt-tw" aria-hidden="true" />
      <span className="nt-ic" aria-hidden="true">
        {question ? <IconHelpCircle size={14} /> : <IconFolder size={14} />}
      </span>
      <input
        ref={ref}
        className="nt-inline-in"
        defaultValue={initial}
        placeholder={question ? "Question…" : "Folder name…"}
        aria-label={initial ? "Rename" : question ? "New question" : "New folder"}
        autoComplete="off"
        // The tree's own keydown owns every key on a row; this input owns them
        // all while it is open, so nothing here is allowed to reach it.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); finish(true); }
          else if (e.key === "Escape") { e.preventDefault(); finish(false); }
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}
