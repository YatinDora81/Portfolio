"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "./command-palette";
import { StagingProvider, useStaging } from "@/components/staging/staging-provider";
import { SaveBar } from "@/components/staging/save-bar";
import { cn } from "@/lib/utils";

interface Toast { id: number; msg: string; tone: "good" | "bad"; out?: boolean }

let toastId = 0;

/**
 * Drives `.cr.hot` — the amber topbar keyline that control-room.css has always
 * had and nothing has ever switched on. It marks the whole room as holding
 * unsaved work, so the state is visible from any page even when the save bar is
 * scrolled past or the reader has navigated away from the rows it belongs to.
 *
 * The class goes on the node rather than through Shell's state because `.cr` is
 * rendered *above* the staging provider (the provider's dialog portals into it),
 * and threading the count back up would mean lifting the store out of the tree
 * that owns it.
 */
function StagingHeat() {
  const { count } = useStaging();
  useEffect(() => {
    const el = document.querySelector(".cr");
    if (!el) return;
    el.classList.toggle("hot", count > 0);
    return () => el.classList.remove("hot");
  }, [count]);
  return null;
}

export function Shell({ user, unread, children }: {
  user: { userId: string; email: string; role: string };
  unread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sbOpen, setSbOpen] = useState(false);
  const [pal, setPal] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, tone: "good" | "bad" = "good") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x))), 2600);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2950);
  }, []);

  // ⌘K / Ctrl-K toggles the palette.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // A dialog covers the palette, and the palette's input autofocuses, so
        // opening one under a dialog would take the keyboard somewhere nobody
        // can see. Closing an already-open palette is still fine.
        const dialogOpen = document.querySelector(".veil") !== null;
        setPal((p) => (p ? false : !dialogOpen));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="cr">
      {/* Staged edits live above the routed content, so they survive a jump to
          another page and the save bar travels with them. */}
      <StagingProvider toast={toast}>
        <StagingHeat />
        {/* Eighteen nav rows sit before the page for anyone tabbing in. */}
        <a className="skip" href="#content">Skip to content</a>
        {sbOpen ? <div className="sb-veil" onClick={() => setSbOpen(false)} /> : null}

        <Sidebar user={user} unread={unread} open={sbOpen} onNavigate={() => setSbOpen(false)} />

        <main className="main">
          <TopBar
            user={user}
            onBurger={() => setSbOpen(true)}
            onPalette={() => setPal(true)}
            toast={toast}
          />
          {/* Outside the keyed scroller: the batch outlives the route, so
              navigating must not remount the bar mid-save. */}
          <div className="content" id="content" tabIndex={-1} key={pathname}>{children}</div>
          <SaveBar />
        </main>

        {pal ? <CommandPalette onClose={() => setPal(false)} /> : null}
      </StagingProvider>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={cn("toast", t.tone === "bad" && "bad", t.out && "out")}>
            {t.tone === "bad"
              ? <IconAlertTriangle size={15} className="tic" />
              : <IconCircleCheck size={15} className="tic" />}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
