"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsMove,
  IconBraces,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconFilePlus,
  IconFileText,
  IconFolderPlus,
  IconPencil,
  IconTrash,
  IconFileZip,
} from "@tabler/icons-react";
import { NOTES_ROOT, type NoteKind } from "@/lib/notes/view-types";
import { cn } from "@/lib/utils";

export interface MenuTarget {
  id: string;
  title: string;
  kind: NoteKind;
  x: number;
  y: number;
}

export interface TreeMenuProps {
  target: MenuTarget;
  onNew: (kind: NoteKind) => void;
  onRename: () => void;
  onMove: () => void;
  onNudge: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onClose: () => void;
}

type Icon = React.ComponentType<{ size?: number }>;

interface Row {
  key: string;
  label: string;
  icon: Icon;
  kb?: string;
  danger?: boolean;
  href?: string;
  run?: () => void;
  sub?: boolean;
}

export function TreeMenu({
  target, onNew, onRename, onMove, onNudge, onDuplicate, onTrash, onClose,
}: TreeMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"main" | "export">("main");
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  const folder = target.kind === "FOLDER";

  const act = (fn: () => void) => () => { onClose(); fn(); };

  const main: (Row | "sep")[] = [
    ...(folder
      ? ([
          { key: "nq", label: "New question", icon: IconFilePlus, run: act(() => onNew("QUESTION")) },
          { key: "nf", label: "New folder", icon: IconFolderPlus, run: act(() => onNew("FOLDER")) },
          "sep",
        ] as (Row | "sep")[])
      : []),
    { key: "rn", label: "Rename", icon: IconPencil, kb: "F2", run: act(onRename) },
    { key: "mv", label: "Move to…", icon: IconArrowsMove, kb: "Space", run: act(onMove) },
    { key: "up", label: "Move up", icon: IconArrowUp, kb: "⌥↑", run: act(() => onNudge(-1)) },
    { key: "dn", label: "Move down", icon: IconArrowDown, kb: "⌥↓", run: act(() => onNudge(1)) },
    { key: "dup", label: "Duplicate", icon: IconCopy, run: act(onDuplicate) },
    { key: "ex", label: "Export…", icon: IconDownload, sub: true, run: () => setView("export") },
    "sep",
    { key: "tr", label: "Move to trash", icon: IconTrash, kb: "⌫", danger: true, run: act(onTrash) },
  ];

  const exportHref = (format: string) =>
    `${NOTES_ROOT}/export?id=${encodeURIComponent(target.id)}&format=${format}`;

  const formats: (Row | "sep")[] = [
    { key: "back", label: "Back", icon: IconChevronLeft, run: () => setView("main") },
    "sep",
    { key: "md", label: "Markdown (.md)", icon: IconFileText, href: exportHref("md") },
    { key: "json", label: "JSON (.json)", icon: IconBraces, href: exportHref("json") },
    ...(folder
      ? ([{ key: "zip", label: "Folder as ZIP (.zip)", icon: IconFileZip, href: exportHref("zip") }] as Row[])
      : []),
  ];

  const rows = view === "main" ? main : formats;

  const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-mi]") ?? [])];

  useEffect(() => { focusables()[0]?.focus(); }, [view]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [target.x, target.y, view]);

  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const gone = () => onClose();
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", gone);
    window.addEventListener("scroll", gone, true);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("scroll", gone, true);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]!.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]!.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]!.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]!.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowLeft" && view === "export") { e.preventDefault(); setView("main"); }
    else if (e.key === "ArrowRight" && (document.activeElement as HTMLElement)?.dataset.sub) {
      e.preventDefault();
      setView("export");
    }
  };

  return (
    <div
      ref={ref}
      className="nt-menu"
      role="menu"
      aria-label={view === "export" ? `Export ${target.title}` : `Actions for ${target.title}`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
    >
      {rows.map((row, i) =>
        row === "sep" ? (
          <div key={`sep${i}`} className="nt-msep" role="separator" />
        ) : row.href ? (
          <a
            key={row.key}
            data-mi
            role="menuitem"
            tabIndex={-1}
            className="nt-mi"
            href={row.href}
            download
            onClick={onClose}
          >
            <row.icon size={15} />
            {row.label}
          </a>
        ) : (
          <button
            key={row.key}
            data-mi
            data-sub={row.sub ? "true" : undefined}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cn("nt-mi", row.danger && "danger")}
            aria-haspopup={row.sub ? "menu" : undefined}
            onClick={row.run}
          >
            <row.icon size={15} />
            {row.label}
            {row.kb ? <span className="nt-mk">{row.kb}</span> : null}
            {row.sub ? <span className="nt-mk"><IconChevronRight size={12} /></span> : null}
          </button>
        )
      )}
    </div>
  );
}
