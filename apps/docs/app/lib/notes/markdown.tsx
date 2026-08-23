import type { ReactNode } from "react";

/**
 * Markdown for answer bodies, rendered into React elements.
 *
 * It used to say "on the server", and the reader was a server component. Both
 * halves of this file now run in the browser as well — the revise deck always
 * did, and the reader joined it when the vault moved into memory. The rule below
 * did not change, and is more load-bearing for the move, not less: elements out,
 * never an HTML string, and never `dangerouslySetInnerHTML`. That is not stylistic — React escapes text nodes
 * for us, so nothing an answer body contains can become markup by accident, and
 * the only place a body can still reach the DOM as anything but text is an
 * `href`. `safeHref` guards it.
 *
 * The dialect is small on purpose: fences, inline code, paragraphs, `-`/`*` and
 * `1.` lists, `#` headings, `>` quotes, `**bold**`, `*italic*` and links.
 *
 * On top of that sit three `:::` containers, which exist because a revision
 * vault is not prose: a question you can answer, an answer you can hide until
 * you have tried, and an aside that should not read as the next sentence.
 *
 *     ::: quiz Which of these is O(log n)?
 *     - Linear search
 *     + Binary search
 *     = It halves the range each step.
 *     :::
 *
 *     ::: details Why does this work?      ::: note Heads up
 *     Any **markdown**, including more     Any markdown. `tip` and `warn`
 *     containers.                          are the other two.
 *     :::                                  :::
 *
 * **None of them ship JavaScript.** The reader is a server component and the
 * revise deck renders the same function on the client, so a block that needed a
 * hook would have to be one or the other. `details`/`summary` is the browser's
 * own accordion, and the quiz marks a choice right or wrong through `:checked`
 * in the stylesheet — which is also why these three are the only blocks here
 * that emit class names. An unknown container word is not a container: it falls
 * through and renders as the literal text, visibly, the same way `safeHref`
 * leaves a refused link as prose.
 */
export function renderMarkdown(src: string): ReactNode {
  return <>{blocks(src.replace(/\r\n?/g, "\n").split("\n"))}</>;
}

const FENCE = /^ {0,3}```/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^ {0,3}[-*]\s+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

/** Only the words below open a container. Anything else after `:::` is prose,
 *  so a typo shows itself instead of swallowing the rest of the note. */
const OPEN = /^ {0,3}:::[ \t]*(quiz|details|note|tip|warn)\b[ \t]*(.*)$/i;
const CLOSE = /^ {0,3}:::[ \t]*$/;
/** Inside a quiz: `+` is a correct choice, `-` a wrong one, `=` the reason. */
const CHOICE = /^ {0,3}([+-])\s+(.*)$/;
const BECAUSE = /^ {0,3}=\s?(.*)$/;

const H = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const CALLOUT: Record<string, string> = { note: "Note", tip: "Tip", warn: "Careful" };

/**
 * FNV-1a over the block's own text.
 *
 * Two jobs, both of which a positional key cannot do. Radio groups need a `name`
 * no other quiz on the page shares. And the revise deck renders one card after
 * another into the same position, so a key of "the third block" lets React reuse
 * the DOM node — and an uncontrolled radio carries the previous card's tick over
 * with it. Keying on content remounts instead. Deterministic, so the server's
 * markup and the client's first render agree.
 */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Each level copies the lines below it, so unclosed `:::` nests quadratically. */
const MAX_CONTAINER_DEPTH = 16;

/**
 * Blocks are scanned line by line rather than split on blank lines first. A
 * fenced block is allowed to contain a blank line — code usually does — and any
 * splitter that runs before the fences are found tears that block in half and
 * renders the second half as prose.
 */
function blocks(lines: string[], depth = 0): ReactNode[] {
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

    const open = OPEN.exec(line);
    if (open) {
      const kind = (open[1] ?? "").toLowerCase();
      const title = (open[2] ?? "").trim();
      const { body, next } = container(lines, i + 1);
      i = next;
      const id = hash(`${kind}${title}${body.join("\n")}`);
      // At the cap the container is flattened, but it must still be CONSUMED:
      // `opensBlock` counts `:::` as an opener, so a line left for the paragraph
      // branch ends that run before it advances `i`, and the scanner spins here.
      out.push(
        depth >= MAX_CONTAINER_DEPTH ? (
          <p key={`${key}-${id}`}>{lineRun([line, ...body], `${key}-${id}`)}</p>
        ) : kind === "quiz" ? (
          quiz(title, body, `${key}-${id}`, id)
        ) : kind === "details" ? (
          accordion(title, body, `${key}-${id}`, depth)
        ) : (
          callout(kind, title, body, `${key}-${id}`, depth)
        ),
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

/**
 * Every predicate here must have a branch in `blocks` that consumes the line.
 * A closing `:::` deliberately is NOT one: `container` reads its own terminator,
 * so a `:::` reaching this point is a stray with nothing to close, and listing
 * it would end the paragraph without anything advancing past it — a loop rather
 * than a rendering bug. Left out, it is ordinary text, which is also what a
 * writer who typed one by accident should see.
 */
function opensBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    OPEN.test(line)
  );
}

/**
 * The lines up to the `:::` that closes this container, and where to carry on.
 *
 * Nesting is counted rather than stopped at the first close, so a `details`
 * inside a `details` survives. Fences are tracked while counting because a code
 * sample is entitled to contain a line of three colons — the same reason
 * `blocks` scans for fences before it splits anything.
 *
 * A container nobody closed runs to the end of the body, which is what the
 * fence handler above does with a missing back-tick: the writer sees their text,
 * laid out oddly, rather than losing it.
 */
function container(lines: string[], start: number): { body: string[]; next: number } {
  const body: string[] = [];
  let depth = 1;
  let fenced = false;
  let i = start;

  while (i < lines.length) {
    const l = lines[i] ?? "";
    if (FENCE.test(l)) fenced = !fenced;
    else if (!fenced) {
      if (CLOSE.test(l)) {
        depth--;
        if (!depth) {
          i++;
          break;
        }
      } else if (OPEN.test(l)) depth++;
    }
    body.push(l);
    i++;
  }

  return { body, next: i };
}

/**
 * A question you answer by clicking, marked right or wrong by the stylesheet.
 *
 * More than one `+` turns the radios into checkboxes, because a group of radios
 * that wants two answers is a control that cannot express its own rules.
 *
 * The reveal is a `details`, and it NAMES the correct choices rather than
 * relying on the ✓ that `:checked` paints — that mark is decoration, and a
 * quiz whose answer is only reachable by pointing at it is a quiz half the
 * people using it cannot finish.
 */
function quiz(title: string, lines: string[], key: string, id: string): ReactNode {
  const prompt: string[] = title ? [title] : [];
  const choices: { ok: boolean; text: string }[] = [];
  const because: string[] = [];

  for (const l of lines) {
    const c = CHOICE.exec(l);
    if (c) {
      choices.push({ ok: c[1] === "+", text: c[2] ?? "" });
      continue;
    }
    const b = BECAUSE.exec(l);
    if (b) {
      because.push(b[1] ?? "");
      continue;
    }
    if (!l.trim()) continue;
    // Before the first choice a loose line is more question; after one it is
    // more explanation. Either way it is never silently dropped.
    (choices.length ? because : prompt).push(l.trim());
  }

  const right = choices.filter((c) => c.ok);
  const many = right.length > 1;

  return (
    <div className="nt-q" key={key}>
      {prompt.length ? <p className="nt-q-ask">{lineRun(prompt, `${key}q`)}</p> : null}
      {choices.length ? (
        <div className="nt-q-opts" role="group">
          {choices.map((c, n) => (
            <label className={c.ok ? "nt-q-o ok" : "nt-q-o"} key={n}>
              <input type={many ? "checkbox" : "radio"} name={`q${id}`} />
              <span className="nt-q-box" aria-hidden="true" />
              <span className="nt-q-t">{inline(c.text, `${key}o${n}`)}</span>
            </label>
          ))}
        </div>
      ) : null}
      {right.length || because.length ? (
        <details className="nt-q-why">
          <summary>Show answer</summary>
          {right.length ? (
            <p className="nt-q-ans">
              {right.map((c, n) => (
                <strong key={n}>
                  {n ? " · " : null}
                  {inline(c.text, `${key}a${n}`)}
                </strong>
              ))}
            </p>
          ) : null}
          {because.length ? <p>{lineRun(because, `${key}w`)}</p> : null}
        </details>
      ) : null}
    </div>
  );
}

/** The browser's own accordion. Its contents are markdown, containers included,
 *  so a long derivation can be folded away one step at a time. */
function accordion(title: string, body: string[], key: string, depth = 0): ReactNode {
  return (
    <details className="nt-acc" key={key}>
      <summary>{title ? inline(title, `${key}s`) : "Details"}</summary>
      <div className="nt-acc-b">{blocks(body, depth + 1)}</div>
    </details>
  );
}

/** An aside that should not read as the next sentence. `aside` rather than a
 *  `div`, because that is exactly what it is. */
function callout(kind: string, title: string, body: string[], key: string, depth = 0): ReactNode {
  return (
    <aside className={`nt-call ${kind}`} key={key}>
      <p className="nt-call-t">{title ? inline(title, `${key}t`) : (CALLOUT[kind] ?? "Note")}</p>
      {blocks(body, depth + 1)}
    </aside>
  );
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
