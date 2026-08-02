import Link from "next/link";
import { prisma } from "db";
import { TERMINAL_COMMANDS, NOT_FOUND_OUTPUT } from "@repo/ui/terminal";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { AboutSectionNav } from "../about/section-nav";
import { BlockHead } from "../about/block-head";
import {
  IconArrowRight, IconTerminal2, IconKeyboard, IconAlertTriangle, IconEye, IconEyeOff,
  IconArrowUpRight, IconLock,
} from "@tabler/icons-react";

/**
 * Reference for the About-section terminal — the second half of section 02.
 *
 * Everything here is read from @repo/ui/terminal — the same list the portfolio
 * drives its behaviour from — so this page cannot describe a command that
 * doesn't exist, or claim the wrong focus behaviour.
 *
 * It is filed under About rather than under Site because that is where the
 * terminal lives on the page, and it shares About's `.abt-*` chrome (the same
 * section nav, the same numbered block rules) so the two routes read as one
 * place. It writes NOTHING: there is no model behind a command table, and an
 * editing affordance here would be a lie in the shape of a button.
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

const KIND_LABEL: Record<string, string> = {
  nav: "Navigation · moves you to a section",
  info: "Answers in place · stays in the terminal",
  action: "Leaves the page",
  egg: "Undocumented · not in help, ls or Tab",
};

const KEYS = [
  { k: "Enter", d: "Run the line." },
  { k: "Tab", d: "Accept the ghost suggestion; with nothing to complete, indent to the next 4-column stop." },
  { k: "Shift + Tab", d: "Leave the prompt — deliberately not captured, so the terminal is never a keyboard trap." },
  { k: "Esc", d: "Release the prompt without running anything." },
  { k: "↑ / ↓", d: "Walk command history. Survives clear." },
  { k: "→", d: "At the end of the line, accepts the ghost suggestion." },
];

export default async function TerminalPage() {
  // The terminal prints these, so it's worth seeing what it will actually say.
  const [paragraphs, blogCount] = await Promise.all([
    prisma.aboutParagraph.count(),
    prisma.blog.count({ where: { show: true } }),
  ]);

  const byKind = (["nav", "info", "action", "egg"] as const).map((kind) => ({
    kind,
    items: TERMINAL_COMMANDS.filter((c) => c.kind === kind),
  }));

  const discoverable = TERMINAL_COMMANDS.filter((c) => c.discoverable).length;
  const hidden = TERMINAL_COMMANDS.length - discoverable;
  const keepsFocus = TERMINAL_COMMANDS.filter((c) => c.keepsFocus).length;

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 02 · reference · about terminal"
        title="whoami"
        description="The About section is a working shell. Every command it accepts, what it prints, and whether the caret stays put afterwards — read straight from the command table the site itself runs on."
      />

      <div className="sec-strip">
        <div className="sec-mark" aria-hidden="true">&gt;_</div>
        <div className="sec-anchor">
          <span>#about</span>
          <a href={`${SITE}/#about`} target="_blank" rel="noreferrer">
            open on the site <IconArrowUpRight size={11} className="nudge" />
          </a>
        </div>
        {/* No `.sec-reach`: this page changes nothing, which is the point of it. */}
      </div>

      <AboutSectionNav active="terminal" />

      <div className="abt-ro">
        <IconLock size={15} stroke={1.6} aria-hidden="true" />
        <div>
          <b>Reference, not a form</b>
          There is no table behind this page and nothing on it can be changed here. Every row is
          derived from <code>@repo/ui/terminal</code>, the module the live terminal runs on — edit a
          command there and this page follows. What the terminal <i>prints</i> is CMS copy, and
          that lives one tab over on{" "}
          <Link href="/about" className="abt-foot-l">Bio &amp; education</Link>.
        </div>
      </div>

      <div className="abt-facts">
        <span className="chip">{TERMINAL_COMMANDS.length} commands</span>
        <span className="chip on">{discoverable} in help, ls &amp; Tab</span>
        <span className="chip off">{hidden} undocumented</span>
        <span className="chip">{keepsFocus} keep the caret</span>
        <span className="chip">{paragraphs} paragraph{paragraphs === 1 ? "" : "s"} on whoami</span>
      </div>

      {blogCount === 0 && (
        <div className="ico-warn">
          <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
          <div>
            <b>No published blog posts, so <code>blogs</code> is currently hidden</b>
            The terminal drops nav commands whose section isn&rsquo;t on the page, so <code>blogs</code>
            {" "}won&rsquo;t appear in <code>help</code>, <code>ls</code> or Tab-completion until a post is
            published. That&rsquo;s deliberate — it beats advertising a command that can only error.
          </div>
        </div>
      )}

      <div className="abt-stag">
        <section className="abt-blk">
          <BlockHead n="01" title="Commands">
            Grouped by what Enter does to you, not alphabetically — that is the only grouping the
            terminal itself acts on.
          </BlockHead>

          <Card flush>
            <CardHead title="Every command" count={TERMINAL_COMMANDS.length} />
            <div className="card-b">
              {byKind.map((group, gi) => (
                <div
                  key={group.kind}
                  className="skill-cat"
                  style={gi === byKind.length - 1 ? { marginBottom: 0 } : undefined}
                >
                  <div className="skill-cat-h">
                    <div className="skill-cat-t">{KIND_LABEL[group.kind]}</div>
                    <div className="skill-cat-n">/ {String(group.items.length).padStart(2, "0")}</div>
                  </div>

                  <div className="tbl-scroll">
                    <table className="tbl cmd-tbl">
                      <thead>
                        <tr>
                          <th style={{ width: 130 }}>Command</th>
                          <th style={{ width: 150 }}>After Enter</th>
                          <th>What it prints</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((c) => (
                          <tr key={c.cmd}>
                            <td>
                              <div className="cmd-name">
                                <span className="cmd-prompt">➜</span> {c.cmd}
                              </div>
                              {c.aliases?.length ? (
                                <div className="cmd-alias">also {c.aliases.join(", ")}</div>
                              ) : null}
                            </td>
                            <td>
                              <span className={c.keepsFocus ? "chip on" : "chip"}>
                                {c.keepsFocus ? <IconEye size={11} /> : <IconEyeOff size={11} />}
                                {c.keepsFocus ? "stays focused" : "releases focus"}
                              </span>
                            </td>
                            <td>
                              <div className="cmd-sum">{c.summary}</div>
                              <div className="cmd-out">{c.output}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="abt-blk">
          <BlockHead n="02" title="Anything else">
            The three behaviours that aren&rsquo;t a command: an unknown word, the boot sequence, and
            why the caret is ever handed back.
          </BlockHead>

          <Card flush>
            <CardHead title="Edge behaviour" count={3} />
            <div className="card-b">
              <div className="cmd-note">
                <IconTerminal2 size={15} stroke={1.6} style={{ flex: "none", marginTop: 2 }} />
                <div>
                  <b>Unknown word</b>
                  <span>{NOT_FOUND_OUTPUT}. The caret stays, so you can just retype.</span>
                </div>
              </div>
              <div className="cmd-note">
                <IconArrowRight size={15} stroke={1.6} style={{ flex: "none", marginTop: 2 }} />
                <div>
                  <b>On scroll into view</b>
                  <span>
                    The terminal types <code>whoami</code> itself and prints your{" "}
                    {paragraphs} About paragraph{paragraphs === 1 ? "" : "s"}, then unlocks for input.
                    {" "}<Link href="/about#abt-bio" className="abt-foot-l">Edit those paragraphs</Link>.
                  </span>
                </div>
              </div>
              <div className="cmd-note" style={{ borderBottom: "none", paddingBottom: 0 }}>
                <IconAlertTriangle size={15} stroke={1.6} style={{ flex: "none", marginTop: 2 }} />
                <div>
                  <b>Why focus is released at all</b>
                  <span>
                    Only commands that move you hand the caret back. Holding it would leave you typing at
                    a prompt scrolled off screen — and on a phone, the keyboard would cover whatever you
                    just jumped to.
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section className="abt-blk">
          <BlockHead n="03" title="Keys">
            What the prompt captures while it has focus — and, just as deliberately, what it
            refuses to.
          </BlockHead>

          <Card flush>
            <CardHead
              title="Keyboard"
              count={KEYS.length}
              right={<span className="hint"><IconKeyboard size={13} /> while the prompt has focus</span>}
            />
            <div className="rows">
              {KEYS.map((k) => (
                <div className="row" key={k.k}>
                  <span className="kbd" style={{ flex: "none", minWidth: 84, textAlign: "center" }}>{k.k}</span>
                  <div className="row-main">
                    <div className="row-m" style={{ whiteSpace: "normal", color: "var(--dim)" }}>{k.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>

      <div className="abt-foot">
        <IconTerminal2 size={13} stroke={1.6} aria-hidden="true" />
        <span>
          Source of truth: <code>packages/ui/src/terminal.ts</code>. The bio the shell prints and the
          education timeline below it are edited on{" "}
          <Link href="/about" className="abt-foot-l">About</Link>.
        </span>
      </div>
    </div>
  );
}
