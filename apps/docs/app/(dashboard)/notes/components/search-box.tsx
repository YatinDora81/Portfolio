"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconSearch, IconX } from "@tabler/icons-react";
import { isEmptyQuery, parseQuery, QUICK_FILTERS } from "@/lib/notes/query";
import { NOTES_ROOT } from "@/lib/notes/view-types";
import { cn } from "@/lib/utils";

const SEARCH = `${NOTES_ROOT}/search`;

const DEBOUNCE = 250;

// same split parseQuery uses
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

function addTokens(raw: string, add: string): string {
  const have = new Set(tokensOf(raw).map((t) => t.toLowerCase()));
  return join([...tokensOf(raw), ...tokensOf(add).filter((t) => !have.has(t.toLowerCase()))]);
}

const dropTokens = (raw: string, hit: (t: string) => boolean) =>
  join(tokensOf(raw).filter((t) => !hit(t)));

const tagToken = (tag: string) => (/\s/.test(tag) ? `tag:"${tag}"` : `tag:${tag}`);

function namesTag(token: string, tag: string): boolean {
  const t = token.toLowerCase();
  const want = tag.toLowerCase();
  if (t.startsWith("tag:")) return unquote(t.slice(4)) === want;
  if (t.startsWith("#")) return unquote(t.slice(1)) === want;
  return false;
}

export function SearchBox({
  q,
  count,
  capped,
  facets,
  fromResults,
}: {
  q: string;
  count: number;
  capped: boolean;
  facets: { tag: string; count: number }[];
  fromResults: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [syntax, setSyntax] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const sent = useRef(q);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => cancel(), []);

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(value);
  };

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

  const pick = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const btn = (e.nativeEvent as SubmitEvent).submitter;
    if (btn instanceof HTMLButtonElement) go(btn.value);
  };

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
