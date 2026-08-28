"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/notes/markdown";
import { CONF_LABELS } from "@/lib/notes/query";
import type { ReviseCard } from "@/lib/notes/view-types";
import { useRate } from "./vault-provider";

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
  const [deck, setDeck] = useState(cards);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState<Failure[]>([]);
  const [given, setGiven] = useState<ReadonlyMap<string, number>>(new Map());
  const record = useRate();
  const veil = useRef<HTMLButtonElement>(null);
  const revealed = useRef<HTMLDivElement>(null);

  const card = deck[i];

  const save = useCallback((c: { id: string; title: string }, value: number) => {
    void record(c.id, value)
      .then((r) => {
        if (!r.ok) setFailed((f) => [...f, { id: c.id, title: c.title, value, error: `${r.error}.` }]);
      })
      .catch(() => {
        setFailed((f) => [
          ...f,
          { id: c.id, title: c.title, value, error: "The rating never reached the server." },
        ]);
      });
  }, [record]);

  const rate = useCallback(
    (value: number) => {
      const c = deck[i];
      if (!c) return;
      setI((n) => n + 1);
      setShown(false);
      setGiven((g) => new Map(g).set(c.id, value));
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
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t?.closest(".nt-tp, .nt-menu, .modal")) return;
      if (!card) return;

      if (e.key === "Escape") {
        e.preventDefault();
        router.push(card.href);
        return;
      }
      if (e.key === " ") {
        if (shown) return;
        // a focused button already turns space into a click
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
          {deck.length} card{deck.length === 1 ? "" : "s"} rated. Going again deals the same cards
          back in the order you just put them in — least confident first, so the ones you stumbled
          on come round again first.
        </p>
        <div className="nt-blank-row">
          {deck.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDeck((d) =>
                  [...d].sort(
                    (a, b) =>
                      (given.get(a.id) ?? a.confidence) - (given.get(b.id) ?? b.confidence)
                  )
                );
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
      {/* the counter above already says this */}
      <div className="nt-rev-bar" aria-hidden="true">
        <div className="nt-rev-fill" style={{ width: `${((i + 1) / deck.length) * 100}%` }} />
      </div>

      <h1 className="nt-rev-q">{card.title}</h1>

      {shown ? (
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
