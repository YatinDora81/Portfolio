"use client";

import { useEffect, useRef } from "react";
import type { NextQuestion } from "@/lib/notes/vault-view";
import { NoteLink, unsavedDraft, useNoteNav } from "./vault-provider";

// wheel pixels past the bottom before the move fires
const THRESHOLD = 480;
const TOUCH_GAIN = 2.2;
const IDLE_RESET_MS = 700;
const COOLDOWN_MS = 800;

// module-level: following `next` unmounts this mid-scroll
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

    const scroller = (): HTMLElement => {
      for (let el: HTMLElement | null = pane; el; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
      }
      return (document.scrollingElement ?? document.documentElement) as HTMLElement;
    };

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

    paint();

    const advance = () => {
      fired = true;
      coolUntil = Date.now() + COOLDOWN_MS;
      clearTimeout(idle);
      const s = scroller();
      go(next.href);
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

    // firefox reports wheel deltas in lines, not pixels
    const pixels = (e: WheelEvent) =>
      e.deltaMode === 1 ? e.deltaY * 16
      : e.deltaMode === 2 ? e.deltaY * window.innerHeight
      : e.deltaY;

    const onWheel = (e: WheelEvent) => {
      if (!pane.contains(e.target as Node)) return;
      if (e.ctrlKey || e.metaKey) return;
      const dy = pixels(e);
      if (dy <= 0) {
        if (progress) reset();
        return;
      }
      if (Date.now() < coolUntil) {
        e.preventDefault();
        return;
      }
      if (!atBottom()) return;
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
