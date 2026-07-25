"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconCircleCheck, IconAlertTriangle } from "@tabler/icons-react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "./command-palette";
import { cn } from "@/lib/utils";

interface Toast { id: number; msg: string; tone: "good" | "bad"; out?: boolean }

let toastId = 0;

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
        setPal((p) => !p);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="cr">
      {sbOpen ? <div className="sb-veil" onClick={() => setSbOpen(false)} /> : null}

      <Sidebar user={user} unread={unread} open={sbOpen} onNavigate={() => setSbOpen(false)} />

      <main className="main">
        <TopBar
          user={user}
          onBurger={() => setSbOpen(true)}
          onPalette={() => setPal(true)}
          toast={toast}
        />
        <div className="content" key={pathname}>{children}</div>
      </main>

      {pal ? <CommandPalette onClose={() => setPal(false)} /> : null}

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
