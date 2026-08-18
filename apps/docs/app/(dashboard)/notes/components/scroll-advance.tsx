"use client";

import { useEffect, useRef } from "react";
import type { NextQuestion } from "@/lib/notes/vault-view";
import { NoteLink, unsavedDraft, useNoteNav } from "./vault-provider";

/**
 * Scrolling past the end of an answer continues into the next question.
 *
 * Reaching the bottom does nothing on its own — the last line deserves to be
 * read in peace. The gesture only starts once the reader is already at the
 * bottom and keeps going: wheel or drag from there fills a thin bar, and
 * crossing the threshold follows `next`. Letting go, scrolling up, or simply
 * pausing drains it back to zero, so a flick that was really about reaching
 * the action row costs nothing.
 *
 * "Next" is reading order across the whole vault (`nextQuestionIn`), so the
 * gesture walks out of a finished folder into the following one and climbs
 * levels when they run out. The move itself is `useNoteNav().go` — the same
 * shallow pushState the tree uses, answered from the payload in memory, which
 * is what makes chaining questions feel like one long page.
 *
 * Mounted inside `<EditorLoader>`'s read view on purpose: opening the editor
 * unmounts this along with the prose, so a scroll can never fire mid-draft or
 * summon the unsaved-changes confirm. The `unsavedDraft` check below is the
 * belt to that suspender.
 */

/** Wheel pixels past the bottom before the move fires. */
const THRESHOLD = 480;
/** Touch deltas are small and precious; a finger should not work 3x a wheel. */
const TOUCH_GAIN = 2.2;
/** A pause mid-fill reads as a change of mind. */
const IDLE_RESET_MS = 700;
/** Long enough to outlast trackpad momentum; the wheel path eats it, `arm` only declines it. */
const COOLDOWN_MS = 800;

/**
 * Module-level for the same reason `unsavedDraft` is: the reader is keyed on
 * the note, so following `next` unmounts this very component while the wheel
 * still has momentum. A ref would be torn down with it; this survives to tell
 * the next mount that the leftover ticks are not a new gesture.
 */
let coolUntil = 0;

export function ScrollAdvance({ next }: { next: NextQuestion | null }) {
  const go = useNoteNav();
  const footRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const foot = footRef.current;
    const pane = foot?.closest<HTMLElement>(".nt-pane");
    if (!next || !foot || !pane) return;

    let progress = 0;
    let touchY: number | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let fired = false;

    // Desktop scrolls the pane; below the 900px breakpoint `.nt-pane` goes
    // `overflow: visible` and the vault drops back into `.content`'s flow. The
    // document is never the scroller in this shell — `.cr` is `height: 100dvh;
    // overflow: hidden` — so anything that assumes it reads `scrollHeight ===
    // clientHeight`, calls that the bottom, and swallows the whole page's
    // scrolling. The nearest scrollable ancestor is the honest answer, and
    // resolving it per event means crossing the breakpoint needs no plumbing.
    const scroller = (): HTMLElement => {
      for (let el: HTMLElement | null = pane; el; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
      }
      return (document.scrollingElement ?? document.documentElement) as HTMLElement;
    };

    // Also true when the answer is shorter than the pane and there is nothing
    // to scroll — which is exactly when overscroll should still mean "next".
    const atBottom = () => {
      const s = scroller();
      return s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
    };

    const paint = () => {
      const fill = fillRef.current;
      if (fill) fill.style.width = `${Math.min(100, Math.round((progress / THRESHOLD) * 100))}%`;
    };

    const reset = () => {
      progress = 0;
      paint();
    };

    // The effect re-runs on every render — `next` is a fresh object — which
    // zeroes `progress` while the bar's inline width survives on a node that
    // was never unmounted. Painting on setup keeps the two telling one story.
    paint();

    const advance = () => {
      fired = true;
      coolUntil = Date.now() + COOLDOWN_MS;
      clearTimeout(idle);
      const s = scroller();
      go(next.href);
      // The shell resets the pane on navigation; the phone's document scroller
      // is nobody else's job, and landing at the FOOT of the next answer would
      // read as a bug. Harmlessly redundant on desktop.
      s.scrollTo({ top: 0 });
    };

    const arm = (delta: number) => {
      if (fired || Date.now() < coolUntil || unsavedDraft.current) return;
      progress = Math.max(0, progress + delta);
      paint();
      clearTimeout(idle);
      idle = setTimeout(reset, IDLE_RESET_MS);
      if (progress >= THRESHOLD) advance();
    };

    // `deltaY` is in pixels only when `deltaMode` is 0. Firefox on Windows and
    // Linux reports LINES for a physical mouse wheel — three per notch — so a
    // raw sum creeps toward a threshold written in pixels and never arrives,
    // while every one of those notches is being swallowed below.
    const pixels = (e: WheelEvent) =>
      e.deltaMode === 1 ? e.deltaY * 16
      : e.deltaMode === 2 ? e.deltaY * window.innerHeight
      : e.deltaY;

    // On window, not on the pane: below the breakpoint the pane is not the
    // scroller, and a wheel over the sidebar is filtered out by `contains`.
    const onWheel = (e: WheelEvent) => {
      if (!pane.contains(e.target as Node)) return;
      // Zoom arrives as a wheel with a modifier — that is how pinch reaches the
      // page. Swallowing it would trade the browser's zoom for a navigation.
      if (e.ctrlKey || e.metaKey) return;
      const dy = pixels(e);
      if (dy <= 0) {
        if (progress) reset();
        return;
      }
      // `arm` declining to fire again stops a chain-advance, not the browser:
      // an unprevented wheel on the next answer — which is long, so `atBottom`
      // is false — scrolls it natively, away from the top the move just set.
      // Swallowing momentum means eating the event, not returning from it.
      if (Date.now() < coolUntil) {
        e.preventDefault();
        return;
      }
      if (!atBottom()) return;
      // Own the gesture only once it means something — at the bottom, with a
      // next to go to. Everywhere else native scrolling is untouched.
      e.preventDefault();
      arm(dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null || !pane.contains(e.target as Node)) return;
      const y = e.touches[0]?.clientY ?? touchY;
      const delta = touchY - y;
      touchY = y;
      if (delta > 0 && Date.now() < coolUntil) {
        e.preventDefault();
        return;
      }
      if (delta > 0 && atBottom()) {
        e.preventDefault();
        arm(delta * TOUCH_GAIN);
      }
    };

    const onTouchEnd = () => {
      touchY = null;
      if (progress < THRESHOLD) reset();
    };

    const onScroll = () => {
      if (progress && !atBottom()) reset();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    // A scroll event does not bubble, so listening on the pane and the window
    // hears nothing at the breakpoint where `.content` is what moves.
    const host = scroller();
    pane.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    if (host !== pane) host.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearTimeout(idle);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      pane.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      host.removeEventListener("scroll", onScroll);
    };
  }, [next, go]);

  // The vault's final question. Saying so beats a bar that silently never fills.
  if (!next) {
    return (
      <div className="nt-adv nt-adv-end">
        <span className="nt-adv-lb">end of the vault</span>
      </div>
    );
  }

  return (
    <nav ref={footRef} className="nt-adv" aria-label="Continue reading">
      <div className="nt-adv-row">
        <span className="nt-adv-lb">keep scrolling</span>
        {/* A real link as well as a gesture target: click, ⌘-click and keyboard
            all work without ever touching the bar. */}
        <NoteLink className="nt-adv-next" href={next.href}>
          {next.sameFolder ? "next" : `next · ${next.parentTitle}`} — {next.title}
        </NoteLink>
      </div>
      <div className="nt-adv-track" aria-hidden="true">
        <div ref={fillRef} className="nt-adv-fill" />
      </div>
    </nav>
  );
}
