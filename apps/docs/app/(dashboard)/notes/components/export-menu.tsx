"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconBraces, IconDownload, IconFileText, IconFileZip } from "@tabler/icons-react";

type ExportKind = "FOLDER" | "QUESTION" | "VAULT";

interface Choice {
  format: "md" | "json" | "zip";
  label: string;
  hint: string;
  Icon: typeof IconFileText;
}

const CHOICES: Choice[] = [
  { format: "md", label: "Markdown", hint: ".md", Icon: IconFileText },
  { format: "json", label: "JSON", hint: ".json", Icon: IconBraces },
  { format: "zip", label: "Archive", hint: ".zip", Icon: IconFileZip },
];

const choicesFor = (kind: ExportKind) =>
  kind === "QUESTION" ? CHOICES.filter((c) => c.format !== "zip") : CHOICES;

const noun = (kind: ExportKind, title: string) => (kind === "VAULT" ? "the whole vault" : title);

export function ExportMenu({ nodeId, kind, title }: { nodeId: string | null; kind: ExportKind; title: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const choices = choicesFor(kind);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 208;
    setAt({
      top: Math.min(r.bottom + 6, window.innerHeight - 16),
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    // fixed positioning does not follow the page
    const onScroll = () => close(false);

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place, close]);

  useEffect(() => {
    if (open && at) menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [open, at]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    const i = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(true);
    }
  };

  const href = (format: string) =>
    `/notes/export?format=${format}${nodeId ? `&id=${encodeURIComponent(nodeId)}` : ""}`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Export ${noun(kind, title)}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IconDownload size={15} stroke={1.7} />
        Export
      </button>

      {open && at ? (
        <div
          ref={menuRef}
          className="nt-menu"
          role="menu"
          aria-label={`Export ${noun(kind, title)}`}
          style={{ top: at.top, left: at.left }}
          onKeyDown={onMenuKey}
        >
          {choices.map(({ format, label, hint, Icon }) => (
            <a
              key={format}
              role="menuitem"
              className="nt-mi"
              href={href(format)}
              download
              onClick={() => close(false)}
            >
              <Icon size={15} stroke={1.7} />
              {label}
              <span className="nt-mk">{hint}</span>
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
