import type { ReactNode } from "react";

/**
 * Markdown for answer bodies, rendered on the server into React elements.
 *
 * Read mode ships no editor JS, so the reader is a server component and this is
 * the whole renderer: elements out, never an HTML string, and never
 * `dangerouslySetInnerHTML`. That is not stylistic — React escapes text nodes
 * for us, so nothing an answer body contains can become markup by accident, and
 * the only place a body can still reach the DOM as anything but text is an
 * `href`. `safeHref` guards it.
 *
 * The dialect is small on purpose: fences, inline code, paragraphs, `-`/`*` and
 * `1.` lists, `#` headings, `>` quotes, `**bold**`, `*italic*` and links. No
 * classes are emitted; the caller wraps the output in `.nt-answer` and styles
 * plain element names, so what a note looks like stays in the stylesheet.
 */
export function renderMarkdown(src: string): ReactNode {
  return <>{blocks(src.replace(/\r\n?/g, "\n").split("\n"))}</>;
}

const FENCE = /^ {0,3}```/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^ {0,3}[-*]\s+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

const H = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * Blocks are scanned line by line rather than split on blank lines first. A
 * fenced block is allowed to contain a blank line — code usually does — and any
 * splitter that runs before the fences are found tears that block in half and
 * renders the second half as prose.
 */
function blocks(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const key = `b${i}`;

    if (!line.trim()) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++; // the closing fence — or the end of the body, when the writer forgot it
      out.push(
        <pre key={key}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const Tag = H[(heading[1] ?? "").length - 1] ?? "h6";
      out.push(<Tag key={key}>{inline(heading[2] ?? "", key)}</Tag>);
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = BULLET.exec(lines[i] ?? "");
        if (!m) break;
        items.push(m[1] ?? "");
        i++;
      }
      out.push(<ul key={key}>{items.map((t, n) => <li key={n}>{inline(t, `${key}i${n}`)}</li>)}</ul>);
      continue;
    }

    const first = ORDERED.exec(line);
    if (first) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = ORDERED.exec(lines[i] ?? "");
        if (!m) break;
        items.push(m[2] ?? "");
        i++;
      }
      const from = Number(first[1] ?? "1");
      out.push(
        <ol key={key} start={from === 1 ? undefined : from}>
          {items.map((t, n) => <li key={n}>{inline(t, `${key}i${n}`)}</li>)}
        </ol>,
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i] ?? "");
        if (!m) break;
        quoted.push(m[1] ?? "");
        i++;
      }
      out.push(<blockquote key={key}>{lineRun(quoted, key)}</blockquote>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || opensBlock(l)) break;
      para.push(l);
      i++;
    }
    out.push(<p key={key}>{lineRun(para, key)}</p>);
  }

  return out;
}

function opensBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line);
}

/** A run of lines inside one block: single newlines are breaks, not paragraphs. */
function lineRun(lines: string[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((l, n) => {
    if (n) out.push(<br key={`${key}br${n}`} />);
    out.push(...inline(l, `${key}l${n}`));
  });
  return out;
}

/**
 * Ordered alternation, and the order is the parse: code first so a fenced-off
 * `**not bold**` stays literal, then links, then bold before italic so `**x**`
 * is never read as an empty emphasis wrapping `*x*`.
 */
const INLINE = /(`[^`\n]+`)|(\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^\n]+?\*\*)|(\*[^*\n]+\*)/;

function inline(src: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const token = m[0];
    if (m.index > last) out.push(src.slice(last, m.index));
    const k = `${key}m${n++}`;
    if (m[1]) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(link(token, k));
    else if (m[3]) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    else out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    last = m.index + token.length;
  }

  if (last < src.length) out.push(src.slice(last));
  return out;
}

function link(token: string, key: string): ReactNode {
  const m = /^\[([^\]\n]*)\]\(([^)\n]*)\)$/.exec(token);
  const href = safeHref(m?.[2] ?? "");
  if (!m || !href) return token;
  return (
    <a key={key} href={href}>
      {inline(m[1] ?? "", key)}
    </a>
  );
}

/**
 * The one security-relevant rule in this file. A body is written by an admin,
 * but "the author is trusted" stops being a model the moment text is pasted in
 * from somewhere else: `javascript:` in an href runs on click, in the admin's
 * own session. Three shapes are allowed to become links — absolute http(s),
 * site-relative, and an in-page fragment — and anything else falls back to the
 * literal markdown text, which is visible and harmless. `//host` is refused with
 * the rest: it looks site-relative and is not.
 */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("#")) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return null;
}
