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

interface Flat {
  node: VaultItem;
  level: number;
  pos: number;
  size: number;
  parentId: string | null;
  ancestorTitles: string[];
}

interface Toast {
  id: number;
  msg: string;
  tone: "good" | "bad";
  undo?: () => void;
}

let toastSeq = 0;

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
  const { tree, trashCount, vaultEmpty, byPath } = useVault();
  const router = useRouter();
  const pathname = usePathname();
  const go = useNoteNav();
  const [pending, startTransition] = useTransition();

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

  const byId = useMemo(() => new Map(flat.map((f) => [f.node.id, f])), [flat]);
  const selectedId = byPath.get(activePath)?.id ?? null;

  const parsed = useMemo(() => parseQuery(filter), [filter]);

  const deferred = useMemo(
    () => [
      ...parsed.is.filter((x) => x === "trashed").map((x) => `is:${x}`),
      ...parsed.notIs.filter((x) => x === "trashed").map((x) => `-is:${x}`),
    ],
    [parsed]
  );

  const local = useMemo<ParsedQuery>(
    () => ({
      ...parsed,
      is: parsed.is.filter((x) => x !== "trashed"),
      notIs: parsed.notIs.filter((x) => x !== "trashed"),
    }),
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
                body: n.answer?.body ?? "",
                tags: n.answer?.tags ?? [],
                confidence: n.answer?.confidence ?? 0,
                lastRevisedAt: n.answer?.lastRevisedAt ?? null,
                ancestorTitles: f.ancestorTitles,
              },
              local
            )
          : matchFolder({ title: n.title, deletedAt: null }, local);
      if (!ok) continue;
      hit.add(n.id);
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

  const shownKids = useCallback(
    (node: VaultItem) => (hidden.size ? node.children.filter((c) => !hidden.has(c.id)) : node.children),
    [hidden]
  );

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

  const rovingId = useMemo(() => {
    if (focusId && visible.some((v) => v.node.id === focusId)) return focusId;
    return visible[0]?.node.id ?? null;
  }, [focusId, visible]);

  const focusRow = useCallback((id: string | null | undefined) => {
    if (!id) return;
    setFocusId(id);
    setFocusTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!focusTick || !focusId) return;
    if (renaming || creating || menu) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-nid="${CSS.escape(focusId)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, focusId]);

  const showToast = useCallback((msg: string, tone: "good" | "bad", undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ id: ++toastSeq, msg, tone, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 9000 : 4000);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const run = useCallback(
    <R extends Res>(fn: () => Promise<R>, after?: (res: Extract<R, { ok: true }>) => void) => {
      startTransition(async () => {
        const res = await fn();
        if (!res.ok) {
          setNotice(res.error);
          showToast(res.error, "bad");
          return;
        }
        after?.(res as Extract<R, { ok: true }>);
      });
    },
    [showToast]
  );

  const toggle = useCallback((id: string, want?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (want === undefined ? next.has(id) : !want) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  useEffect(() => {
    revealPath(activePath);
  }, [activePath, revealPath]);

  useEffect(() => {
    const onReveal = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (path) revealPath(path);
    };
    window.addEventListener("notes:reveal", onReveal);
    return () => window.removeEventListener("notes:reveal", onReveal);
  }, [revealPath]);

  const moveInfo = useMemo(() => {
    if (!grab) return null;
    const node = byId.get(grab)?.node;
    if (!node) return null;
    const cursor = over ? byId.get(over) : null;

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
        focusRow(id);
      }
    );
  };

  const beginCreate = (parentId: string | null, kind: NoteKind) => {
    setMenu(null);
    setRenaming(null);
    setGrab(null);
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

  const typeAhead = useRef({ buf: "", at: 0 });

  const seek = (key: string, from: number): string | undefined => {
    const now = Date.now();
    const ta = typeAhead.current;
    ta.buf = now - ta.at > 700 ? key : ta.buf + key;
    ta.at = now;
    const needle = ta.buf.toLowerCase();
    const start = needle.length > 1 ? from : from + 1;
    const order = [...visible.slice(start), ...visible.slice(0, start)];
    const found = order.find((v) => v.node.title.toLowerCase().startsWith(needle));
    if (found) return found.node.id;
    if (needle.length === 1) return undefined;
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

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
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

  useEffect(() => {
    if (!summary) return;
    const t = setTimeout(() => setNotice(summary), 400);
    return () => clearTimeout(t);
  }, [summary]);

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
        aria-level={level}
        aria-posinset={pos}
        aria-setsize={size}
        aria-selected={node.id === selectedId}
        aria-expanded={folder && kids.length ? open : undefined}
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
          prefetch={false}
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

      <div role="status" aria-live="polite" className="sr-only">
        {moveInfo ? moveText : notice}
      </div>
    </div>
  );
}

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
