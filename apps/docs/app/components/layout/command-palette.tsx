"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconNotebook, IconSearch, IconWorld } from "@tabler/icons-react";
import { NAV_GROUPS, navMark } from "@/lib/nav";
import { searchNotes, type PaletteHit } from "@/lib/actions/notes-search";
import { CONF_LABELS } from "@/lib/notes/query";
import { cn } from "@/lib/utils";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

interface PalItem {
  label: string;
  kind: string;
  where: string | null;
  mark?: string;
  icon: React.ComponentType<{ size?: number }>;
  hay: string;
  parts?: { text: string; hit: boolean }[];
  snippet?: { text: string; hit: boolean }[];
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items: PalItem[] = [
    ...NAV_GROUPS.flatMap((g) =>
      g.items.map((x) => ({
        label: x.label,
        kind: "go",
        where: g.label,
        mark: navMark(x),
        icon: x.icon,
        hay: `${x.label} ${g.label ?? ""} ${x.eyebrow} ${x.href} ${x.keywords ?? ""}`.toLowerCase(),
        run: () => { router.push(x.href); onClose(); },
      }))
    ),
    {
      label: "Open live site",
      kind: "action",
      where: null,
      icon: IconWorld,
      hay: `open live site ${SITE}`.toLowerCase(),
      run: () => { window.open(SITE, "_blank"); onClose(); },
    },
  ];

  const needle = q.trim().toLowerCase();
  const navHits = needle ? items.filter((x) => x.hay.includes(needle)) : items;

  const [notes, setNotes] = useState<{ hits: PaletteHit[]; total: number; bad: string[] }>({
    hits: [], total: 0, bad: [],
  });
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      searchNotes(q).then((r) => { if (live) setNotes(r); }).catch(() => {});
    }, 140);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const noteItems: PalItem[] = notes.hits.map((h) => ({
    label: h.titleParts.map((p) => p.text).join(""),
    kind: CONF_LABELS[h.confidence] ?? "note",
    where: h.folder,
    icon: IconNotebook,
    hay: "",
    parts: h.titleParts,
    snippet: h.snippet,
    run: () => { router.push(h.href); onClose(); },
  }));

  const list = [...navHits, ...noteItems];

  useEffect(() => { setHot(0); }, [q]);

  // list is a new array every render, so the handler depends on the count
  const count = list.length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setHot((i) => Math.min(i + 1, count - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHot((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        router.push(`/notes/search?q=${encodeURIComponent(q)}`);
        onClose();
      }
      else if (e.key === "Enter") {
        e.preventDefault();
        // click the row so the unsaved-changes guard still sees it
        listRef.current?.querySelectorAll<HTMLButtonElement>(".pal-it")[hot]?.click();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [count, hot, onClose, router, q]);

  useEffect(() => {
    listRef.current?.querySelectorAll<HTMLElement>(".pal-it")[hot]
      ?.scrollIntoView({ block: "nearest" });
  }, [hot, count]);

  return (
    <div className="pal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal-box" role="dialog" aria-modal="true" aria-label="Jump to a section">
        <div className="pal-in">
          <IconSearch size={15} style={{ color: "var(--faint)" }} />
          <input
            autoFocus
            placeholder="Jump to a section or run an action…"
            aria-label="Search sections and actions"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="pal-list" ref={listRef}>
          {list.length ? list.map((x, i) => {
            const Icon = x.icon;
            return (
              <button
                key={x.label + i}
                className={cn("pal-it", i === hot && "hot")}
                onMouseEnter={() => setHot(i)}
                onClick={x.run}
              >
                <span className="pal-n" aria-hidden="true">{x.mark ?? ""}</span>
                <Icon size={15} />
                <span className="pal-t">
                  {x.parts
                    ? x.parts.map((p, j) => (p.hit
                        ? <mark key={j} className="nt-hit">{p.text}</mark>
                        : <Fragment key={j}>{p.text}</Fragment>))
                    : x.label}
                  {x.snippet?.length ? (
                    <span className="pal-w">
                      {x.snippet.map((p, j) => (p.hit
                        ? <mark key={j} className="nt-hit">{p.text}</mark>
                        : <Fragment key={j}>{p.text}</Fragment>))}
                    </span>
                  ) : x.where ? <span className="pal-w">{x.where}</span> : null}
                </span>
                <span className="pal-k">{x.kind}</span>
              </button>
            );
          }) : (
            <div style={{ padding: "18px 14px", color: "var(--faint)", fontSize: 13 }}>
              Nothing matches “{q}” — NekoCat looked everywhere.
              {notes.bad.length ? (
                <div className="nt-bad" style={{ marginTop: 6 }}>
                  unknown filter: {notes.bad.join(", ")}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="pal-foot">
          <span><b className="kbd">↵</b> open</span>
          <span><b className="kbd">⌘↵</b> all note results</span>
          <span style={{ marginLeft: "auto" }}>
            {notes.total > notes.hits.length ? `${notes.hits.length} of ${notes.total} notes` : null}
          </span>
        </div>
      </div>
    </div>
  );
}
