import { prisma } from "db";
import { TERMINAL_COMMANDS, NOT_FOUND_OUTPUT } from "@repo/ui/terminal";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import {
  IconArrowRight, IconTerminal2, IconKeyboard, IconAlertTriangle, IconEye, IconEyeOff,
} from "@tabler/icons-react";

/**
 * Reference for the About-section terminal.
 *
 * Everything here is read from @repo/ui/terminal — the same list the portfolio
 * drives its behaviour from — so this page cannot describe a command that
 * doesn't exist, or claim the wrong focus behaviour.
 */

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

  return (
    <div className="view">
      <PageHeader
        eyebrow="reference · about terminal"
        title="whoami"
        description="The About section is a working shell. Every command it accepts, what it prints, and whether the caret stays put afterwards — read straight from the command table the site itself runs on."
      />

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

      <Card flush>
        <CardHead title="Commands" count={TERMINAL_COMMANDS.length} />
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

      <div style={{ height: 14 }} />

      <Card flush>
        <CardHead title="Anything else" />
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
                Edit those under Content → About.
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

      <div style={{ height: 14 }} />

      <Card flush>
        <CardHead title="Keys" count={KEYS.length} right={<span className="hint"><IconKeyboard size={13} /> while the prompt has focus</span>} />
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
    </div>
  );
}
