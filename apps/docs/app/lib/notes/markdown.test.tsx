import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "./markdown";

/**
 * The renderer returns elements, so the assertions go through the same
 * server-side render the reader page does. Anything that shows up as escaped
 * text here is text in the browser too — that is the point of not producing an
 * HTML string anywhere in the pipeline.
 */
const html = (src: string) => renderToStaticMarkup(renderMarkdown(src));

describe("renderMarkdown · blocks", () => {
  test("prose becomes a paragraph", () => {
    expect(html("union find")).toBe("<p>union find</p>");
  });

  test("a blank line starts a new paragraph, a single newline is a break", () => {
    expect(html("one\ntwo\n\nthree")).toBe("<p>one<br/>two</p><p>three</p>");
  });

  test("### is a heading, and its depth is the number of hashes", () => {
    expect(html("### Why\n\n# Top")).toBe("<h3>Why</h3><h1>Top</h1>");
  });

  test("- and * both open a bullet list", () => {
    expect(html("- one\n* two")).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  test("a numbered list is ordered, and keeps the number it started on", () => {
    expect(html("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(html("3. three")).toBe('<ol start="3"><li>three</li></ol>');
  });

  test("a list interrupts the paragraph above it", () => {
    expect(html("intro\n- one")).toBe("<p>intro</p><ul><li>one</li></ul>");
  });

  test("> is a blockquote", () => {
    expect(html("> quoted\n> still")).toBe("<blockquote>quoted<br/>still</blockquote>");
  });
});

describe("renderMarkdown · fenced code", () => {
  test("a fence becomes pre + code", () => {
    expect(html("```\nlet x = 1;\n```")).toBe("<pre><code>let x = 1;</code></pre>");
  });

  test("markdown inside a fence is left untouched", () => {
    const out = html("```\n**not bold** and *not italic*\n- not a list\n```");
    expect(out).toBe("<pre><code>**not bold** and *not italic*\n- not a list</code></pre>");
    expect(out).not.toContain("<strong>");
    expect(out).not.toContain("<li>");
  });

  test("a blank line inside a fence does not split the block", () => {
    expect(html("```\nfirst\n\nsecond\n```")).toBe("<pre><code>first\n\nsecond</code></pre>");
  });

  test("the language tag is not content", () => {
    expect(html("```ts\nconst a = 1;\n```")).toBe("<pre><code>const a = 1;</code></pre>");
  });

  test("an unclosed fence still renders as code rather than swallowing nothing", () => {
    expect(html("```\nstranded")).toBe("<pre><code>stranded</code></pre>");
  });
});

describe("renderMarkdown · inline", () => {
  test("backticks are inline code, and their contents are literal", () => {
    expect(html("use `O(n log n)` here")).toBe("<p>use <code>O(n log n)</code> here</p>");
    expect(html("`**stars**`")).toBe("<p><code>**stars**</code></p>");
  });

  test("bold and italic", () => {
    expect(html("**hard** and *soft*")).toBe("<p><strong>hard</strong> and <em>soft</em></p>");
  });

  test("inline markup works inside list items and headings", () => {
    expect(html("- a `b` c")).toBe("<ul><li>a <code>b</code> c</li></ul>");
    expect(html("### a **b**")).toBe("<h3>a <strong>b</strong></h3>");
  });
});

describe("renderMarkdown · links", () => {
  test("http and https are links", () => {
    expect(html("[docs](https://example.com/a?b=1)")).toBe('<p><a href="https://example.com/a?b=1">docs</a></p>');
  });

  test("site-relative and in-page targets are links", () => {
    expect(html("[notes](/notes)")).toBe('<p><a href="/notes">notes</a></p>');
    expect(html("[top](#top)")).toBe('<p><a href="#top">top</a></p>');
  });

  test("a javascript: url is not a link — it renders as the text it was", () => {
    const out = html("[boom](javascript:alert(1))");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
    expect(out).toBe("<p>[boom](javascript:alert(1))</p>");
  });

  test("data: and protocol-relative urls are not links either", () => {
    expect(html("[x](data:text/html,hi)")).toBe("<p>[x](data:text/html,hi)</p>");
    expect(html("[x](//evil.example.com)")).toBe("<p>[x](//evil.example.com)</p>");
    expect(html("[x](  JavaScript:alert(1) )")).not.toContain("<a");
  });

  test("link text still takes inline markup", () => {
    expect(html("[**bold**](/x)")).toBe('<p><a href="/x"><strong>bold</strong></a></p>');
  });
});

describe("renderMarkdown · containers", () => {
  const QUIZ = ["::: quiz Which is O(log n)?", "- Linear search", "+ Binary search", "= It halves the range.", ":::"].join("\n");

  test("a quiz asks, offers radios, and hides the answer behind a details", () => {
    const out = html(QUIZ);
    expect(out).toContain("Which is O(log n)?");
    expect(out).toContain('type="radio"');
    // The right choice is marked in the class, so the stylesheet can say so on
    // :checked — nothing in the reading order gives it away first.
    expect(out).toContain('class="nt-q-o ok"');
    expect(out).toContain("<summary>Show answer</summary>");
    expect(out).toContain("It halves the range.");
    expect(out).not.toContain("<script");
  });

  test("the reveal names the correct choice rather than leaving it to a ✓ nobody can hear", () => {
    expect(html(QUIZ)).toContain("<strong>Binary search</strong>");
  });

  test("two correct choices make it a checkbox, because radios cannot express that", () => {
    const many = ["::: quiz Pick both", "+ one", "+ two", "- three", ":::"].join("\n");
    expect(html(many)).toContain('type="checkbox"');
    expect(html(many)).not.toContain('type="radio"');
  });

  test("every quiz gets its own radio group", () => {
    const two = `${QUIZ}\n\n::: quiz Something else?\n+ yes\n- no\n:::`;
    const names = [...html(two).matchAll(/name="(q[a-z0-9]+)"/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(2);
  });

  test("a details is the browser's own accordion, and its body is still markdown", () => {
    const out = html("::: details Why\nSome **bold** text.\n\n- a list\n:::");
    expect(out).toContain("<summary>Why</summary>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<ul><li>a list</li></ul>");
  });

  test("containers nest, and the outer one does not close on the inner one's :::", () => {
    const out = html("::: details Outer\n::: note Inner\ninside\n:::\nafter\n:::");
    expect(out).toContain("<summary>Outer</summary>");
    expect(out).toContain("Inner");
    expect(out).toContain("inside");
    expect(out).toContain("after");
  });

  test("three colons inside a fence are code, not a closing marker", () => {
    const out = html("::: note\n```\n:::\n```\nstill inside\n:::");
    expect(out).toContain("<code>:::</code>");
    expect(out).toContain("still inside");
  });

  test("the three callouts each get their own class, and a default title", () => {
    expect(html("::: note\nx\n:::")).toContain('class="nt-call note"');
    expect(html("::: tip\nx\n:::")).toContain("Tip");
    expect(html("::: warn\nx\n:::")).toContain("Careful");
    expect(html("::: warn Mind this\nx\n:::")).toContain("Mind this");
  });

  test("an unknown container word is prose, not a container that ate the rest", () => {
    const out = html("::: sparkle\nstill here\n:::");
    expect(out).toContain("::: sparkle");
    expect(out).toContain("still here");
    expect(out).not.toContain("nt-call");
  });

  test("a container nobody closed runs to the end rather than losing the text", () => {
    expect(html("::: note\nleft open")).toContain("left open");
  });

  test("a stray closing marker is text, and does not hang the renderer", () => {
    // It reached `blocks` with nothing to close, and a line that ends a
    // paragraph without being consumed by anything is an infinite loop.
    expect(html(":::")).toBe("<p>:::</p>");
    expect(html("text\n:::\nmore")).toContain("more");
  });

  test("nesting past the depth cap flattens rather than spinning on one line", () => {
    // Same trap as the stray marker above, reached the other way: capping the
    // depth by declining to match `:::` leaves the line for the paragraph
    // branch, which stops on it without advancing. It has to stay consumed.
    const deep = 40;
    const out = html(
      [
        ...Array.from({ length: deep }, (_, n) => `::: note L${n}`),
        "deepest",
        ...Array.from({ length: deep }, () => ":::"),
      ].join("\n"),
    );
    expect(out).toContain("deepest");
    expect(out.length).toBeLessThan(100_000);
  });

  test("a loose line before the choices is more question, after them more reason", () => {
    const out = html("::: quiz\nWhat prints?\n+ 1\n- 2\nbecause of the closure\n:::");
    expect(out).toContain("What prints?");
    expect(out).toContain("because of the closure");
  });

  test("containers render without a key warning", () => {
    const errors: unknown[][] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      html(`${QUIZ}\n\n::: details D\ntext\n:::\n\n::: tip T\ntext\n:::`);
    } finally {
      console.error = real;
    }
    expect(errors).toEqual([]);
  });

  test("a quiz is deterministic, so the server's markup and the client's agree", () => {
    expect(html(QUIZ)).toBe(html(QUIZ));
  });
});

describe("renderMarkdown · safety and hygiene", () => {
  test("markup in a body is text, not markup", () => {
    expect(html("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  test("an img with an onerror is text too", () => {
    expect(html('<img src=x onerror="alert(1)">')).not.toContain("<img");
  });

  test("every element in a list carries a key", () => {
    const errors: unknown[][] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      html("one\ntwo\n\n- a\n- b\n\n1. x\n2. y\n\n> q\n> r\n\n**a** *b* `c` [d](/e)");
    } finally {
      console.error = real;
    }
    expect(errors).toEqual([]);
  });

  test("an empty body renders nothing", () => {
    expect(html("")).toBe("");
    expect(html("\n\n  \n")).toBe("");
  });
});
