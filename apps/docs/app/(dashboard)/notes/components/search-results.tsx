import { Fragment } from "react";
import Link from "next/link";
import { confLabel, isEmptyQuery, type ParsedQuery } from "@/lib/notes/query";
import { NOTES_ROOT, type ResultCard } from "@/lib/notes/view-types";

const SEARCH = `${NOTES_ROOT}/search`;

function Painted({ parts }: { parts: { text: string; hit: boolean }[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="nt-hit">{p.text}</mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}

export function SearchResults({ q, cards }: { q: ParsedQuery; cards: ResultCard[] }) {
  if (isEmptyQuery(q)) {
    return (
      <div className="nt-sr-body">
        <div className="nt-empty">
          Nothing asked for yet.
          <br />
          Pick a quick filter or a tag above, or type a word.
        </div>
      </div>
    );
  }

  if (!cards.length) return <NoMatch q={q} />;

  const groups = new Map<string, ResultCard[]>();
  for (const c of cards) {
    const list = groups.get(c.group);
    if (list) list.push(c);
    else groups.set(c.group, [c]);
  }

  const active = new Set(q.tags);

  return (
    <div className="nt-sr-body">
      {[...groups].map(([group, list]) => (
        <Fragment key={group}>
          <div className="nt-res-grp">{group}</div>
          {list.map((c) => (
            <Link key={c.id} href={c.href} className="nt-res">
              <div className="nt-res-t"><Painted parts={c.titleParts} /></div>
              {c.snippet.length ? <div className="nt-res-s"><Painted parts={c.snippet} /></div> : null}
              <div className="nt-res-m">
                {c.tags.map((t) => (
                  <span key={t} className={active.has(t.toLowerCase()) ? "nt-tg on" : "nt-tg"}>{t}</span>
                ))}
                <span className="nt-cf">{confLabel(c.confidence)}</span>
              </div>
            </Link>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function NoMatch({ q }: { q: ParsedQuery }) {
  const filtered =
    q.tags.length || q.notTags.length || q.in.length ||
    q.is.length || q.notIs.length || q.conf.length || q.has.length;
  const words = [...q.text, ...q.phrases.map((p) => `"${p}"`)].join(" ");

  return (
    <div className="nt-sr-body">
      <div className="nt-empty">
        No question matches that.
        <br />
        {filtered
          ? "The filters may be narrower than the words are."
          : "Try one word rather than several, or a tag."}
      </div>
      {filtered ? (
        <form className="nt-blank-row" method="get" action={SEARCH}>
          <button type="submit" name="q" value={words} className="btn ghost">
            {words ? `Search ${words} without the filters` : "Clear the filters"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
