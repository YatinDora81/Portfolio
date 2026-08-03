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
  /** The literal the unsaved-changes guard reads off `.pal-k` — "go" means this
      row navigates and must be intercepted. Do not reword it. */
  kind: string;
  /** Group heading, shown as the row's second line so "site" or "page" finds it. */
  where: string | null;
  /** Sidebar ordinal, so a row in the palette is recognisably the same row. */
  mark?: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Everything the query is matched against, lowercased once. Notes are
      matched by Postgres, not here, so their rows carry an empty haystack and
      are appended rather than filtered. */
  hay: string;
  /** Pre-segmented title for a note row, so the matched words can be marked
      without building HTML out of a title somebody typed. */
  parts?: { text: string; hit: boolean }[];
  /** The one-line answer excerpt under a note row. */
  snippet?: { text: string; hit: boolean }[];
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Built from NAV_GROUPS rather than the flat list so the palette keeps the
  // sidebar's order and can say which group a match came from.
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

  /**
   * The vault answers for itself.
   *
   * The palette cannot filter notes the way it filters nav rows — there is no
   * in-memory list to filter, and building one would put every answer body in
   * the bundle of every admin page. So the query goes to the server and comes
   * back parsed by the same engine the tree filter and the search page use,
   * which is what makes `tag:redis` mean one thing in all three.
   */
  const [notes, setNotes] = useState<{ hits: PaletteHit[]; total: number; bad: string[] }>({
    hits: [], total: 0, bad: [],
  });
  useEffect(() => {
    // Debounced, and guarded against the reply to a keystroke the user has
    // already typed past arriving after a later one.
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

  // The handler below is rebuilt whenever its dependencies change, and `list` is
  // a fresh array on every render — so it depends on the COUNT instead, and
  // reaches the row it wants through the DOM. Otherwise every keystroke tears
  // down and re-adds a window listener.
  const count = list.length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setHot((i) => Math.min(i + 1, count - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHot((i) => Math.max(i - 1, 0)); }
      // ⌘↵ leaves the palette for the full search page, which is the only place
      // that can show more than the first twenty and the facets over them.
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        router.push(`/notes/search?q=${encodeURIComponent(q)}`);
        onClose();
      }
      else if (e.key === "Enter") {
        e.preventDefault();
        // Click the highlighted row rather than calling `run()` straight. The
        // unsaved-changes guard intercepts navigation by listening for clicks,
        // so calling `run()` here would push the route with no confirm — and
        // Enter is how a command palette is actually used. Going through the
        // DOM keeps both paths identical and needs no knowledge of the guard.
        listRef.current?.querySelectorAll<HTMLButtonElement>(".pal-it")[hot]?.click();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [count, hot, onClose, router, q]);

  // Keeps the keyboard selection inside the scroller — arrowing past the fold
  // otherwise highlights a row nobody can see.
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
