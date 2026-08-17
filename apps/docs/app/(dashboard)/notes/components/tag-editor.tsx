"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";
import { saveAnswer } from "@/lib/actions/notes";

/**
 * A tag is also a query, so its label is a link to the search that finds every
 * note carrying it — and the link is written in the syntax a user would type, so
 * clicking a tag and typing `tag:redis` are the same act rather than two
 * parallel features that can drift.
 */
const tagHref = (t: string) => `/notes/search?q=${encodeURIComponent(`tag:${t}`)}`;

/**
 * Returns a fragment, never a wrapper. `.nt-meta` is the flex row and
 * `.nt-conf` claims the far end of it with `margin-left: auto`, which only
 * works while the pills and the dots are siblings in that same row.
 */
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
    // saveAnswer lowercases, trims and dedupes on the way in regardless; the
    // check here only spares a round trip for a tag already on the note.
    if (!t || shown.includes(t)) return;
    commit([...shown, t]);
  };

  return (
    <>
      {shown.map((t) => (
        <span className="nt-tag" key={t}>
          {/* `prefetch={false}` because /notes/search is dynamic and runs its
              query for real: left alone, every tag on a note fires a speculative
              search against Postgres the moment the note is opened — five round
              trips to answer a click nobody has made. Opening a note is supposed
              to cost nothing now, and this was the only thing left that it did
              cost. */}
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
          // Blur closes without adding, the same as Escape. A blur that quietly
          // committed would let a stray click write a half-typed tag, and a tag
          // is vocabulary — the search syntax reads it back.
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
