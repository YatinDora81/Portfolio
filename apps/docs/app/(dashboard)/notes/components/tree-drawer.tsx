"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconBinaryTree, IconCards, IconSearch, IconTrash,
} from "@tabler/icons-react";
import { NOTES_ROOT } from "@/lib/notes/view-types";
import { useVault } from "./vault-provider";

interface Drawer {
  open: boolean;
  show: () => void;
  hide: () => void;
}

const DrawerCtx = createContext<Drawer | null>(null);

export function TreeDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".nt-menu, .veil")) return;
      if (document.querySelector("#nt-tree-panel .nt-inline")) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const onReveal = () => setOpen(true);
    window.addEventListener("notes:reveal", onReveal);
    return () => window.removeEventListener("notes:reveal", onReveal);
  }, []);

  const value = useMemo(() => ({ open, show, hide }), [open, show, hide]);

  return <DrawerCtx.Provider value={value}>{children}</DrawerCtx.Provider>;
}

export function useTreeDrawer(): Drawer {
  const d = useContext(DrawerCtx);
  if (!d) throw new Error("useTreeDrawer outside the notes layout");
  return d;
}

export function TreeVeil() {
  const { open, hide } = useTreeDrawer();
  if (!open) return null;
  return <div className="nt-veil" onClick={hide} />;
}

export function NotesMobileBar() {
  const { open, show } = useTreeDrawer();
  const { trashCount } = useVault();
  const pathname = usePathname();

  const here = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <div className="nt-mbar">
      <button
        type="button"
        className="nt-mbar-b"
        aria-expanded={open}
        aria-controls="nt-tree-panel"
        onClick={show}
      >
        <IconBinaryTree size={15} stroke={1.7} />
        Vault
      </button>
      <span className="nt-mbar-sp" />
      <Link className="nt-mbar-b" href={`${NOTES_ROOT}/search`} aria-current={here(`${NOTES_ROOT}/search`)}>
        <IconSearch size={15} stroke={1.7} />
        <span className="nt-mbar-t">Search</span>
      </Link>
      <Link className="nt-mbar-b" href={`${NOTES_ROOT}/revise`} aria-current={here(`${NOTES_ROOT}/revise`)}>
        <IconCards size={15} stroke={1.7} />
        <span className="nt-mbar-t">Revise</span>
      </Link>
      <Link
        className="nt-mbar-b"
        href={`${NOTES_ROOT}/trash`}
        prefetch={false}
        aria-current={here(`${NOTES_ROOT}/trash`)}
      >
        <IconTrash size={15} stroke={1.7} />
        <span className="nt-mbar-t">Trash</span>
        {trashCount ? <span className="nt-n">{trashCount}</span> : null}
      </Link>
    </div>
  );
}
