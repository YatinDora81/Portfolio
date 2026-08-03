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
