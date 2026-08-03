"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconSearch, IconX } from "@tabler/icons-react";
import { isEmptyQuery, parseQuery, QUICK_FILTERS } from "@/lib/notes/query";
import { NOTES_ROOT } from "@/lib/notes/view-types";
import { cn } from "@/lib/utils";

const SEARCH = `${NOTES_ROOT}/search`;

/** Long enough that a whole word costs one navigation, short enough that the
 *  results still feel attached to the keyboard. */
const DEBOUNCE = 250;

/**
 * `parseQuery`'s own split, duplicated here because query.ts does not export it.
 *
 * It has to be the same split. A chip that removes `tag:redis` with a string
 * replace also takes the middle out of `tag:redisson` and leaves behind a query
 * nobody typed — tokens are compared whole, or not at all.
 */
const TOKENS = /(?:[^\s"]+|"[^"]*")+/g;

const SYNTAX: readonly (readonly [string, string])[] = [
  ["union find", "both words — in a title, an answer or a tag"],
  ['"path compression"', "an exact phrase"],
  ["tag:redis", "one tag · #redis is the same thing"],
  ["-tag:redis", "everything except that tag"],
  ["in:graphs", "scope to a folder, by name or by path"],
  ["conf:<=2", "also = > >= < · or conf:shaky"],
  ["is:untagged", "unrated · shaky · empty · never · revised · trashed"],
  ["has:code", "answers holding a fenced block"],
];

const tokensOf = (raw: string) => raw.match(TOKENS) ?? [];
const join = (ts: string[]) => ts.join(" ").trim();
const unquote = (s: string) => s.replace(/^"|"$/g, "");

function hrefForQuery(raw: string): string {
  const t = raw.trim();
  return t ? `${SEARCH}?q=${encodeURIComponent(t)}` : SEARCH;
}

const hasToken = (raw: string, token: string) =>
  tokensOf(raw).some((t) => t.toLowerCase() === token.toLowerCase());

/** Adds only what is missing, token by token, so clicking the `union find` row
 *  of the syntax card on a query that already says `union` adds `find` alone. */
function addTokens(raw: string, add: string): string {
  const have = new Set(tokensOf(raw).map((t) => t.toLowerCase()));
  return join([...tokensOf(raw), ...tokensOf(add).filter((t) => !have.has(t.toLowerCase()))]);
}

const dropTokens = (raw: string, hit: (t: string) => boolean) =>
  join(tokensOf(raw).filter((t) => !hit(t)));

/** Quoted only when the tag needs it, so the common case stays readable. */
const tagToken = (tag: string) => (/\s/.test(tag) ? `tag:"${tag}"` : `tag:${tag}`);

/** Whether a token names this tag *positively* — `#x` and `tag:x` are one thing
 *  to the parser, and `-tag:x` is a different token that a chip must not eat. */
function namesTag(token: string, tag: string): boolean {
  const t = token.toLowerCase();
  const want = tag.toLowerCase();
  if (t.startsWith("tag:")) return unquote(t.slice(4)) === want;
  if (t.startsWith("#")) return unquote(t.slice(1)) === want;
  return false;
}

/**
 * The search head: the box, the syntax card, the quick filters and the facets.
 *
 * The URL is the state. Every control here is a real link or a real GET form
 * aimed at /notes/search, so the page still searches with the tab hydrating or
 * with scripting off entirely; the handlers only upgrade a document load into a
 * client navigation. That is also why the box is the one client file — nothing
 * else on the page needs to be.
 *
 * Typing `replace`s and chips `push`: a query built one keystroke at a time is
 * one destination, but a chip is a decision, and Back should undo it.
 */
export function SearchBox({
  q,
  count,
  capped,
  facets,
  fromResults,
}: {
  q: string;
  count: number;
  /** More hits exist than the page asked for; the count is a floor, not a total. */
  capped: boolean;
  facets: { tag: string; count: number }[];
  /** Whether the facets describe these results or stand in for the whole vault. */
  fromResults: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [syntax, setSyntax] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  /** The query this box last put in the URL, so it can tell its own echo from a
   *  navigation that happened elsewhere. */
  const sent = useRef(q);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => cancel(), []);

  // Back, forward and a click on a result all move `q` underneath the box, and
  // the input has to follow. Re-imposing the prop on every render instead would
  // undo the keystroke that has not been sent yet — hence the guard, and hence
  // the caret staying exactly where the typist left it.
  useEffect(() => {
    if (q === sent.current) return;
    sent.current = q;
    setValue(q);
  }, [q]);

  const send = (next: string) => {
    cancel();
    sent.current = next.trim();
    router.replace(hrefForQuery(next), { scroll: false });
  };

  const type = (next: string) => {
    setValue(next);
    cancel();
    timer.current = window.setTimeout(() => send(next), DEBOUNCE);
  };

  /** Enter only settles what is already being typed, so it replaces rather than
   *  pushes: a query built one keystroke at a time is one destination, and Back
   *  should leave it, not walk back through it. */
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(value);
  };

  /** A query the user picked rather than typed: no debounce, and it earns a
   *  history entry. Cancelling first matters — a pending keystroke would land
   *  after the click and quietly put the old query back. */
  const go = (next: string) => {
    cancel();
    const t = next.trim();
    setValue(t);
    sent.current = t;
    router.push(hrefForQuery(t));
  };

  const clear = () => {
    setValue("");
    send("");
    input.current?.focus();
  };

  /** Every button row below is a GET form whose submitter carries the query it
   *  would produce, so the no-script path and the click path can only ever
   *  navigate to the same place. */
  const pick = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const btn = (e.nativeEvent as SubmitEvent).submitter;
    if (btn instanceof HTMLButtonElement) go(btn.value);
  };

  // Read off the box, not off the URL: the chips light up and the unknown-filter
  // notice appears while the query is still being typed, in step with the input
  // that produced them. Only the result count belongs to the server.
  const parsed = parseQuery(value);
  const activeTags = new Set(parsed.tags);

  return (
    <div className="nt-sr-head">
      <form className="nt-sr-box" role="search" method="get" action={SEARCH} onSubmit={submit}>
        <IconSearch size={15} stroke={1.7} aria-hidden />
        <input
          ref={input}
          name="q"
          value={value}
          onChange={(e) => type(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            clear();
          }}
          placeholder="union find, tag:redis, in:graphs, conf:<=2, -is:solid"
          aria-label="Search notes"
          autoComplete="off"
          spellCheck={false}
        />
        {value ? (
          <Link
            href={SEARCH}
            className="nt-sr-clr"
            aria-label="Clear search"
            title="Clear · Esc"
            onClick={(e) => { e.preventDefault(); clear(); }}
          >
            <IconX size={15} />
          </Link>
        ) : null}
      </form>

      <div className="nt-sr-meta">
        <span aria-live="polite">
          {isEmptyQuery(parsed)
            ? "Type to search titles, answers and tags."
            : capped
              ? `more than ${count} results · showing the first ${count}`
              : `${count} result${count === 1 ? "" : "s"}`}
        </span>
        {parsed.bad.length ? (
          <span className="nt-bad">not understood: {parsed.bad.join(", ")}</span>
        ) : null}
        <button type="button" onClick={() => setSyntax((s) => !s)} aria-expanded={syntax} aria-controls="nt-syntax">
          syntax
        </button>
      </div>

      <form id="nt-syntax" className={cn("nt-syntax", syntax && "on")} method="get" action={SEARCH} onSubmit={pick}>
        <table>
          <tbody>
            {SYNTAX.map(([example, means]) => (
              <tr key={example}>
                <td>
                  {/* Adds the example to whatever is already typed rather than
                      replacing it: the card is read mid-query, and wiping the
                      words someone came here with is not help. */}
                  <button type="submit" name="q" value={addTokens(value, example)} title="Add to the query">
                    <code>{example}</code>
                  </button>
                </td>
                <td>{means}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>

      <form className="nt-qf" method="get" action={SEARCH} onSubmit={pick}>
        {QUICK_FILTERS.map((f) => {
          const on = hasToken(value, f.q);
          const next = on ? dropTokens(value, (t) => t.toLowerCase() === f.q) : addTokens(value, f.q);
          return (
            <button key={f.q} type="submit" name="q" value={next} className={on ? "on" : undefined} aria-pressed={on} title={f.q}>
              {f.label}
            </button>
          );
        })}
      </form>

      {facets.length ? (
        <div className="nt-facets">
          <span className="nt-facet-lb">{fromResults ? "tags in these results" : "all tags"}</span>
          {facets.map((f) => {
            const on = activeTags.has(f.tag.toLowerCase());
            const next = on
              ? dropTokens(value, (t) => namesTag(t, f.tag))
              : addTokens(value, tagToken(f.tag));
            return (
              <Link
                key={f.tag}
                href={hrefForQuery(next)}
                className={cn("nt-chip", on && "on")}
                title={on ? "Stop filtering by this tag" : "Add this tag to the query"}
                onClick={(e) => { e.preventDefault(); go(next); }}
              >
                {f.tag}
                <span className="nt-chip-c">{f.count}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
