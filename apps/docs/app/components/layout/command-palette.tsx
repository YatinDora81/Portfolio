"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch, IconWorld } from "@tabler/icons-react";
import { ALL_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

interface PalItem {
  label: string;
  kind: string;
  icon: React.ComponentType<{ size?: number }>;
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);

  const items: PalItem[] = [
    ...ALL_NAV.map((x) => ({
      label: x.label,
      kind: "go",
      icon: x.icon,
      run: () => { router.push(x.href); onClose(); },
    })),
    {
      label: "Open live site",
      kind: "action",
      icon: IconWorld,
      run: () => { window.open(SITE, "_blank"); onClose(); },
    },
  ];

  const list = items.filter((x) => x.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => { setHot(0); }, [q]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setHot((i) => Math.min(i + 1, list.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHot((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && list[hot]) { e.preventDefault(); list[hot].run(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [list, hot, onClose]);

  return (
    <div className="pal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal-box">
        <div className="pal-in">
          <IconSearch size={15} style={{ color: "var(--faint)" }} />
          <input
            autoFocus
            placeholder="Jump to a section or run an action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="pal-list">
          {list.length ? list.map((x, i) => {
            const Icon = x.icon;
            return (
              <button
                key={x.label + i}
                className={cn("pal-it", i === hot && "hot")}
                onMouseEnter={() => setHot(i)}
                onClick={x.run}
              >
                <Icon size={15} /> {x.label} <span className="pal-k">{x.kind}</span>
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
