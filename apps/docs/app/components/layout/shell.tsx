"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "./command-palette";
import { StagingProvider, useStaging } from "@/components/staging/staging-provider";
import { SaveBar } from "@/components/staging/save-bar";
import { setRailPref as setRailCookie } from "@/lib/actions/ui-prefs";
import { cn } from "@/lib/utils";

interface Toast { id: number; msg: string; tone: "good" | "bad"; out?: boolean }

let toastId = 0;

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

export function Shell({ user, unread, rail, children }: {
  user: { userId: string; email: string; role: string };
  unread: number;
  rail: boolean | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sbOpen, setSbOpen] = useState(false);
  const [pal, setPal] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [railPref, setRailPref] = useState<boolean | null>(rail);

  const toast = useCallback((msg: string, tone: "good" | "bad" = "good") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x))), 2600);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2950);
  }, []);

  const railedByRoute = pathname === "/notes" || pathname.startsWith("/notes/");
  const railed = railPref ?? railedByRoute;

  // one key for the vault keeps the tree mounted
  const contentKey = railedByRoute ? "/notes" : pathname;

  const toggleRail = useCallback(() => {
    const next = !railed;
    setRailPref(next);
    void setRailCookie(next ? "1" : "0");
  }, [railed]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [toggleRail]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // don't open the palette under a dialog
        const dialogOpen = document.querySelector(".veil") !== null;
        setPal((p) => (p ? false : !dialogOpen));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="cr">

      <StagingProvider toast={toast}>
        <StagingHeat />

        <a className="skip" href="#content">Skip to content</a>
        {sbOpen ? <div className="sb-veil" onClick={() => setSbOpen(false)} /> : null}

        <Sidebar
          user={user}
          unread={unread}
          open={sbOpen}
          railed={railed}
          onNavigate={() => setSbOpen(false)}
        />

        <main className="main">
          <TopBar
            user={user}
            onBurger={() => setSbOpen(true)}
            onPalette={() => setPal(true)}
            railed={railed}
            onRail={toggleRail}
            toast={toast}
          />

          <div className="content" id="content" tabIndex={-1} key={contentKey}>{children}</div>
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
