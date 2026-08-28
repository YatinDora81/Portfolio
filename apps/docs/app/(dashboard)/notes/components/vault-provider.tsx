"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ComponentPropsWithoutRef, type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { setConfidence, type VoidResult } from "@/lib/actions/notes";
import { indexVault, type VaultIndex, type VaultPayload } from "@/lib/notes/vault-view";
import { notePathOf } from "@/lib/notes/view-types";

const VaultCtx = createContext<VaultIndex | null>(null);

export type Rate = (nodeId: string, value: number) => Promise<VoidResult>;
const RateCtx = createContext<Rate | null>(null);

const NO_RATINGS: ReadonlyMap<string, number> = new Map();

export function VaultProvider({ payload, children }: { payload: VaultPayload; children: ReactNode }) {
  const [ratings, setRatings] = useState<ReadonlyMap<string, number>>(NO_RATINGS);
  const seen = useRef(payload);
  if (seen.current !== payload) {
    seen.current = payload;
    if (ratings.size) setRatings(NO_RATINGS);
  }

  const index = useMemo(() => indexVault(payload, ratings), [payload, ratings]);

  const rate = useCallback<Rate>(async (nodeId, value) => {
    setRatings((m) => new Map(m).set(nodeId, value));
    const r = await setConfidence(nodeId, value);
    if (!r.ok) {
      setRatings((m) => {
        const n = new Map(m);
        n.delete(nodeId);
        return n;
      });
    }
    return r;
  }, []);

  return (
    <VaultCtx.Provider value={index}>
      <RateCtx.Provider value={rate}>{children}</RateCtx.Provider>
    </VaultCtx.Provider>
  );
}

export function useVault(): VaultIndex {
  const v = useContext(VaultCtx);
  if (!v) throw new Error("useVault outside the notes layout");
  return v;
}

export function useRate(): Rate {
  const r = useContext(RateCtx);
  if (!r) throw new Error("useRate outside the notes layout");
  return r;
}

export interface NavOptions {
  replace?: boolean;
  afterWrite?: boolean;
}

export function useNoteNav() {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (href: string, opts: NavOptions = {}) => {
      // compare the whole address, not pathname
      if (href === window.location.pathname + window.location.search) return;
      if (unsavedDraft.current && !opts.afterWrite) {
        if (!window.confirm("Discard the changes you haven't saved?")) return;
        unsavedDraft.current = false;
      }
      const shallow =
        !opts.afterWrite && notePathOf(pathname) !== null && notePathOf(bare(href)) !== null;
      if (!shallow) {
        if (opts.replace) router.replace(href);
        else router.push(href);
        return;
      }
      if (opts.replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    },
    [pathname, router]
  );
}

const bare = (href: string) => href.split(/[?#]/)[0]!;

export const unsavedDraft = { current: false };

export function NotePaneShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const landed = useRef(false);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });

    if (!landed.current) {
      landed.current = true;
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="nt-pane" ref={ref} tabIndex={-1}>
      {children}
    </div>
  );
}

export function NoteLink({
  href,
  children,
  ...rest
}: { href: string } & Omit<ComponentPropsWithoutRef<"a">, "href">) {
  const go = useNoteNav();
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        rest.onClick?.(e);
        // modifier clicks belong to the browser
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        go(href);
      }}
    >
      {children}
    </a>
  );
}
