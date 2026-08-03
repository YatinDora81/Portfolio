"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setConfidence } from "@/lib/actions/notes";
import { renderMarkdown } from "@/lib/notes/markdown";
import { CONF_LABELS } from "@/lib/notes/query";
import type { ReviseCard } from "@/lib/notes/view-types";

/**
 * The revise deck: one question at a time, a veil over the answer, and four
 * ratings that write and move on.
 *
 * The answer is rendered here, on the client, rather than being handed down as
 * a React node from the server page. `ReviseCard` carries the body as source
 * text and this component is what decides which card is on screen — so
 * pre-rendering the queue would serialise sixty element trees into the RSC
 * payload to show one of them, and every tree is markup where the source was
 * smaller. `renderMarkdown` is pure, has no dependencies and returns elements
 * rather than an HTML string, so the escaping guarantee that makes it safe on
 * the server is the same guarantee here; nothing in this file goes near
 * `dangerouslySetInnerHTML`.
 */

/** The scale is CONF_LABELS 1–4, derived rather than retyped: the third button
 *  here and `is:shaky` in the search box have to name the same rating. */
const SCALE = CONF_LABELS.slice(1).map((label, i) => ({ value: i + 1, label }));

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Failure {
  id: string;
  title: string;
  value: number;
  error: string;
}

export function ReviseDeck({ cards }: { cards: ReviseCard[] }) {
  const router = useRouter();
  /**
   * The deck is frozen at mount, and that is the load-bearing decision in this
   * file. `setConfidence` revalidates /notes, so every rating pushes a freshly
   * ordered queue down as new props — the card just rated leaves the front, and
   * an index into the incoming array would land the user somewhere they have
   * never been. The queue is a judgement made once, when the page loaded.
   */
  const [deck, setDeck] = useState(cards);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState<Failure[]>([]);
  const veil = useRef<HTMLButtonElement>(null);
  const revealed = useRef<HTMLDivElement>(null);

  const card = deck[i];

  const save = useCallback((c: { id: string; title: string }, value: number) => {
    void setConfidence(c.id, value)
      .then((r) => {
        if (!r.ok) setFailed((f) => [...f, { id: c.id, title: c.title, value, error: `${r.error}.` }]);
      })
      .catch(() => {
        setFailed((f) => [
          ...f,
          { id: c.id, title: c.title, value, error: "The rating never reached the server." },
        ]);
      });
  }, []);

  const rate = useCallback(
    (value: number) => {
      const c = deck[i];
      if (!c) return;
      // The next card is on screen before the write leaves. A rating is one
      // integer on a row that still exists, so a failure is worth a retry
      // rather than a wait — and waiting between cards is what turns a drill
      // into a form.
      setI((n) => n + 1);
      setShown(false);
      save(c, value);
    },
    [deck, i, save],
  );

  const retry = useCallback(() => {
    const again = failed;
    setFailed([]);
    for (const f of again) save(f, f.value);
  }, [failed, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // The tree's filter box and the topbar's palette are on this page too. A
      // digit typed into either is a query, not a rating.
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // The deck shares the page with three surfaces that own the same keys:
      // the tree grabs a row with Space and cancels the move with Escape, and
      // the row menu and any modal close on Escape. A key pressed inside one of
      // them is not a deck key, and handling it here would rate a card or
      // navigate away underneath whatever the user was actually doing.
      if (t?.closest(".nt-tp, .nt-menu, .modal")) return;
      if (!card) return;

      if (e.key === "Escape") {
        e.preventDefault();
        router.push(card.href);
        return;
      }
      if (e.key === " ") {
        if (shown) return;
        // A focused <button> already turns Space into a click of its own, and
        // the veil is a button. Handling it here as well would reveal the card
        // through one path and rate it through the other.
        if (t?.tagName === "BUTTON") return;
        e.preventDefault();
        setShown(true);
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        rate(Number(e.key));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, shown, rate, router]);

  useEffect(() => {
    // Focus follows the card. Parking it on the veil makes Space the browser's
    // own activation rather than a second code path, and stops the rating
    // button clicked a moment ago from still holding focus when the next
    // question arrives; on reveal it moves into the answer, so a screen reader
    // is left where the new text is rather than back at the top of the page.
    if (!card) return;
    const target = shown ? revealed.current : veil.current;
    target?.focus({ preventScroll: true });
  }, [card, shown]);

  const answer = useMemo(() => {
    if (!card) return null;
    if (!card.body.trim()) return <p>No answer written yet — Esc opens the note to write one.</p>;
    return renderMarkdown(card.body);
  }, [card]);

  const alert =
    failed.length === 0 ? null : (
      <div className="nt-live" role="alert">
        <span>
          {failed.length === 1
            ? `“${failed[0]!.title}” kept its old rating. ${failed[0]!.error}`
            : `${failed.length} ratings did not save.`}
        </span>
        <button type="button" className="btn ghost" onClick={retry}>
          Retry
        </button>
      </div>
    );

  if (!card) {
    return (
      <div className="nt-blank">
        <div className="nt-blank-h">Queue clear</div>
        <p className="nt-blank-p">
          {deck.length} card{deck.length === 1 ? "" : "s"} rated. The vault has already reordered
          itself around what you just said, so the next queue will not be this one.
        </p>
        <div className="nt-blank-row">
          {cards.length > 0 && (
            <button
              type="button"
              className="btn"
              // The live prop is already current: every rating revalidated
              // /notes and pushed a new queue down here, which is exactly the
              // ranking the next sitting wants.
              onClick={() => {
                setDeck(cards);
                setI(0);
                setShown(false);
              }}
            >
              Go again
            </button>
          )}
          <Link className="btn" href="/notes/search">
            Search the vault
          </Link>
        </div>
        {alert}
      </div>
    );
  }

  return (
    <div className="nt-rev">
      <div className="nt-rev-top">
        <span>
          revise · {i + 1} of {deck.length} · {CONF_LABELS[card.confidence] ?? CONF_LABELS[0]}
        </span>
        <span>{card.folder}</span>
      </div>
      {/* The counter above says this in words, and a progress bar that announces
          the same fact a second time is noise. */}
      <div className="nt-rev-bar" aria-hidden="true">
        <div className="nt-rev-fill" style={{ width: `${((i + 1) / deck.length) * 100}%` }} />
      </div>

      <h1 className="nt-rev-q">{card.title}</h1>

      {shown ? (
        // Two classes, both doing a job: `.nt-rev-ans` is the box, and the
        // answer's own spacing — paragraphs, lists, code blocks — lives on
        // `.nt-answer`'s descendant rules. Without the second class a
        // three-paragraph answer reveals as one wall of text.
        <div ref={revealed} tabIndex={-1} className="nt-rev-ans nt-answer">
          {answer}
        </div>
      ) : (
        <button ref={veil} type="button" className="nt-rev-veil" onClick={() => setShown(true)}>
          Space to reveal
        </button>
      )}

      <div className="nt-rev-rate">
        {SCALE.map((r) => (
          <button
            key={r.value}
            type="button"
            className="nt-rev-btn"
            aria-keyshortcuts={String(r.value)}
            onClick={() => rate(r.value)}
          >
            {cap(r.label)}
          </button>
        ))}
      </div>

      <p className="nt-rev-kb">1–4 to rate · Esc opens the note</p>
      {alert}
    </div>
  );
}
