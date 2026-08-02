"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconWorld } from "@tabler/icons-react";
import { NAV_GROUPS, navMark } from "@/lib/nav";
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
  /** Everything the query is matched against, lowercased once. */
  hay: string;
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
  const list = needle ? items.filter((x) => x.hay.includes(needle)) : items;

  useEffect(() => { setHot(0); }, [q]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setHot((i) => Math.min(i + 1, list.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHot((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && list[hot]) {
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
  }, [list, hot, onClose]);

  // Keeps the keyboard selection inside the scroller — arrowing past the fold
  // otherwise highlights a row nobody can see.
  useEffect(() => {
    listRef.current?.querySelectorAll<HTMLElement>(".pal-it")[hot]
      ?.scrollIntoView({ block: "nearest" });
  }, [hot, list.length]);

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
                  {x.label}
                  {x.where ? <span className="pal-w">{x.where}</span> : null}
                </span>
                <span className="pal-k">{x.kind}</span>
              </button>
            );
          }) : (
            <div style={{ padding: "18px 14px", color: "var(--faint)", fontSize: 13 }}>
              Nothing matches “{q}” — NekoCat looked everywhere.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
