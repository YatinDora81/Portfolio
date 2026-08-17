"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ComponentPropsWithoutRef, type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { setConfidence, type VoidResult } from "@/lib/actions/notes";
import { indexVault, type VaultIndex, type VaultPayload } from "@/lib/notes/vault-view";
import { notePathOf } from "@/lib/notes/view-types";

/**
 * The vault, held once, in the browser.
 *
 * The layout reads it (vault.ts), this hands it to everything below, and from
 * that point the section stops asking the server questions. The sidebar and the
 * reading pane are looking at the same object, so a title cannot be current in
 * one and stale in the other, and opening a note is a Map lookup rather than
 * three round trips to Neon.
 *
 * `indexVault` runs on every payload — 436 rows, once per server render, which
 * is once per write. That is nothing next to the ~90ms round trip it replaces,
 * and it is the price of never having to reconcile two copies of the tree.
 *
 * **What refreshes this, exactly once and from one place:** a server action whose
 * `touched()` set `pathWasRevalidated`, whose response therefore carries a
 * re-rendered layout. Nothing else does. A shallow navigation makes no request;
 * Next reuses a shared layout across its children, so even a real navigation to
 * Trash and back does not re-run it. That is the whole reason `touched()` calls
 * `updateTag` and not the profile'd form — and it is why a second tab's write is
 * invisible here until this one reloads. Say so rather than implying otherwise.
 */

const VaultCtx = createContext<VaultIndex | null>(null);

/** Records a rating, everywhere, at once. See the overlay below. */
export type Rate = (nodeId: string, value: number) => Promise<VoidResult>;
const RateCtx = createContext<Rate | null>(null);

const NO_RATINGS: ReadonlyMap<string, number> = new Map();

export function VaultProvider({ payload, children }: { payload: VaultPayload; children: ReactNode }) {
  /**
   * Ratings this tab has made that the payload has not caught up with.
   *
   * `setConfidence` deliberately does not carry a re-render home — see `rated()`
   * in lib/actions/notes.ts — because the revise deck fires one per card and the
   * whole vault would come back down the wire each time. The cost of that choice
   * is that nothing refreshes the payload, so without this the folder
   * percentages, the child-row labels and the `conf:` filter would go on quoting
   * pre-rating numbers for the rest of the session.
   *
   * It is not a second source of truth. It is folded into the rows before
   * anything is derived from them, so there is still exactly one index and
   * exactly one answer to "how confident am I about this".
   *
   * Dropped on payload identity, which is precisely the right moment: a new
   * payload is a server read that happened after these writes, so it already
   * contains them.
   */
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
    // The rollback the optimistic hook used to give us, kept: a control that goes
    // on showing a judgement the server refused is worse than one that flickers.
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

/** The only way to record a rating. Calling `setConfidence` directly writes to
 *  Postgres and leaves every number on screen describing the vault as it was. */
export function useRate(): Rate {
  const r = useContext(RateCtx);
  if (!r) throw new Error("useRate outside the notes layout");
  return r;
}

export interface NavOptions {
  replace?: boolean;
  /**
   * This navigation follows a write that has just committed.
   *
   * It forces a real one, and that is not a performance oversight — it is the
   * one case where shallow is actively wrong. Next's patched `pushState`
   * dispatches ACTION_RESTORE, and a navigation takes priority over whatever is
   * in the router's action queue: it marks the pending action `discarded` so its
   * state is never applied. The pending action, right after a save, is the
   * server action's own revalidated payload. Push shallowly there and the write
   * lands in Postgres and never reaches the screen — the sidebar keeps the old
   * title, and the user's next click is on a note that no longer exists.
   *
   * One round trip after a write, which already cost a transaction and a
   * revalidation, is a trade worth making without thinking about it.
   */
  afterWrite?: boolean;
}

/**
 * How the vault moves between notes.
 *
 * Every note under /notes renders from the payload this provider is already
 * holding, so a navigation between two of them has nothing to fetch — the page
 * segment would come back byte-identical. `history.pushState` is Next's own
 * supported way to say exactly that: the address bar and `usePathname` move,
 * the router's tree does not, and no request is made. It is the difference
 * between a click that paints on the next frame and one that waits on Postgres.
 *
 * The guards are what keep it honest. Leaving the reader — Trash, Search,
 * Revise — is a real navigation, because those routes have a page of their own
 * to render. And *arriving* from one of them has to be real too: pushing
 * shallowly while the trash is mounted would change the URL and leave the trash
 * on screen, which is the one failure this whole file could produce. The third
 * is `afterWrite`, above.
 *
 * One rule this hook cannot enforce, so it is written down instead: nothing
 * under /notes may call `router.refresh()`, and nothing may read `useParams()`
 * or `useSelectedLayoutSegment()`. Both are answers off the router's tree, and
 * the router's tree is exactly what stops moving here — they would describe the
 * note you were on two clicks ago, confidently.
 */
export function useNoteNav() {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (href: string, opts: NavOptions = {}) => {
      // Against the whole address, not against `pathname`. Leaving the editor is
      // a move from `/notes/x?edit=1` to `/notes/x`, and `usePathname()` reports
      // those as the same place — compared that way, Cancel does nothing at all.
      if (href === window.location.pathname + window.location.search) return;
      // `afterWrite` means the draft has just been saved — the editor's own
      // `dirty` has not caught up with its props yet, and prompting there would
      // ask the user to confirm discarding what they successfully wrote.
      if (unsavedDraft.current && !opts.afterWrite) {
        if (!window.confirm("Discard the changes you haven't saved?")) return;
        unsavedDraft.current = false;
      }
      // `?edit=1` is a note URL too — edit mode is a searchParam on the reader,
      // and the query has to come off before the path is judged or the editor's
      // own links would each cost a round trip.
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

/**
 * Whether the editor is holding text nobody has saved.
 *
 * Module-level, and that is not laziness: edit mode is a searchParam on the note
 * you are reading, so at most one editor is mounted in a document and there is
 * exactly one answer to the question. Threading it through the vault context
 * would put a value that changes on every keystroke inside the object the whole
 * section re-derives itself from.
 *
 * It exists because this change made leaving cheap. `beforeunload` guards the
 * one exit React cannot intercept, and a shallow navigation is not one — the
 * editor simply unmounts and the draft goes with it. That was survivable when
 * every click cost a round trip and felt like a decision; it is not, now that
 * clicking a row in the tree is a reflex.
 */
export const unsavedDraft = { current: false };

/**
 * The reading pane, and the scroll position it has to give back.
 *
 * `.nt-pane` is its own `overflow-y: auto` box, so the window never scrolls and
 * the router has nothing to restore. It did not have to: every navigation used
 * to replace the pane's contents from the server, and a fresh render starts at
 * the top. A shallow one does not — without this, leaving a long answer halfway
 * down and opening the next one drops you into the middle of a note you have
 * not read a word of.
 */
export function NotePaneShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const landed = useRef(false);
  const pathname = usePathname();

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });

    // Focus, and the test is what makes it origin-aware without being told the
    // origin. A crumb, a sibling chip or a folder row is unmounted by the very
    // navigation it started, and the browser drops focus to <body> — a keyboard
    // user would have to Tab in from the top of the document to read what they
    // just opened. A row in the tree is not unmounted, keeps focus, and must
    // keep it: pulling focus out of the tree would break its roving tabindex and
    // strand somebody mid-branch. So the pane claims focus only when nothing
    // else holds it, and never on the first paint, where the top of the document
    // is the right place to start.
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

/**
 * A link between two notes.
 *
 * A real `<a href>`, so ⌘-click opens a tab, the middle button works, the status
 * bar tells the truth and the right-click menu can copy the address — and a
 * plain left click is taken over and answered from memory. `next/link` is the
 * wrong tool here for the one reason it is usually the right one: it prefetches,
 * and there is nothing to prefetch when the destination is already in the room.
 */
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
        // Everything a modifier means — new tab, new window, download — belongs
        // to the browser.
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
