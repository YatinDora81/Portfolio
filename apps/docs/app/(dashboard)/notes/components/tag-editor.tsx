"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";
import { saveAnswer } from "@/lib/actions/notes";

const tagHref = (t: string) => `/notes/search?q=${encodeURIComponent(`tag:${t}`)}`;

export function TagEditor({ nodeId, tags }: { nodeId: string; tags: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useOptimistic(tags);

  const commit = (next: string[]) =>
    start(async () => {
      setShown(next);
      setError(null);
      const r = await saveAnswer(nodeId, { tags: next });
      if (!r.ok) setError(r.error);
    });

  const add = (raw: string) => {
    const t = raw.trim().toLowerCase();
    setAdding(false);
    // saveAnswer dedupes too; this only spares a round trip
    if (!t || shown.includes(t)) return;
    commit([...shown, t]);
  };

  return (
    <>
      {shown.map((t) => (
        <span className="nt-tag" key={t}>
          <Link href={tagHref(t)} prefetch={false} title={`Find every note tagged ${t}`}>{t}</Link>
          <button
            type="button"
            className="nt-tag-x"
            disabled={pending}
            aria-label={`Remove tag ${t}`}
            onClick={() => commit(shown.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <input
          className="nt-tag-in"
          autoFocus
          size={10}
          placeholder="↵ to add"
          aria-label="New tag"
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setAdding(false);
            }
          }}
        />
      ) : (
        <button type="button" className="nt-tag-add" onClick={() => setAdding(true)}>
          <IconPlus size={11} stroke={2} /> tag
        </button>
      )}

      {error ? <span className="nt-hint nt-bad" role="alert">{error}</span> : null}
    </>
  );
}
