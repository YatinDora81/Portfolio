import Link from "next/link";
import { prisma } from "db";
import { TERMINAL_COMMANDS } from "@repo/ui/terminal";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { StagedAboutPreview } from "@/components/preview/staged";
import { Borrowed } from "@/components/shared/borrowed";
import { AboutParagraphsTable } from "./paragraphs-table";
import { EducationTable } from "./education-table";
import { AboutSectionNav } from "./section-nav";
import { BlockHead } from "./block-head";
import {
  IconArrowUpRight, IconArrowRight, IconLock, IconTerminal2,
} from "@tabler/icons-react";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/$/, "");

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default async function AboutPage() {
  const [paragraphs, education, experiences, configRows] = await Promise.all([
    prisma.aboutParagraph.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.education.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.experience.findMany({ select: { company: true, logoUrl: true } }),
    prisma.siteConfig.findMany({ where: { key: "resumeUrl" } }),
  ]);

  const resumeUrl = configRows.find((c) => c.key === "resumeUrl")?.value ?? "";
  const resumeHost = hostOf(resumeUrl);
  const withLogo = experiences.filter((e) => e.logoUrl).length;

  const discoverable = TERMINAL_COMMANDS.filter(
    (c) => c.discoverable && !(c.cmd === "education" && education.length === 0)
  ).length;

  return (
    <div className="view">
      <PageHeader
        eyebrow="section 02"
        title="About"
        description="The second thing a visitor meets: a working shell that types whoami, prints your bio, and a timeline of where you studied. Both lists below stage their edits and go live together through the save bar."
      />

      <div className="sec-strip">
        <div className="sec-mark" aria-hidden="true">02</div>
        <div className="sec-anchor">
          <span>#about</span>
          <a href={`${SITE}/#about`} target="_blank" rel="noreferrer">
            open on the site <IconArrowUpRight size={11} className="nudge" />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">also what the terminal prints on whoami</span>
          <span className="chip">also where the terminal&rsquo;s education jump lands</span>
        </div>
      </div>

      <AboutSectionNav active="about" />

      <div className="abt-shell">
        <div className="abt-shell-h">
          <span style={{ display: "flex", gap: 5, flex: "none" }} aria-hidden="true">
            <span className="dot" style={{ background: "var(--bad)", opacity: .8 }} />
            <span className="dot" style={{ background: "var(--amber)", opacity: .8 }} />
            <span className="dot" style={{ background: "var(--good)", opacity: .8 }} />
          </span>
          <span className="abt-shell-t">about — zsh</span>
          <div className="sp" style={{ flex: 1 }} />
          <span className="abt-shell-t">live values</span>
        </div>

        <div className="abt-shell-b">
          <a className="abt-l" href="#abt-bio">
            <span className="cmd-prompt" aria-hidden="true">➜</span>
            <span>whoami</span>
            <span className="abt-out">
              <span className="abt-arrow" aria-hidden="true">→ </span>
              {paragraphs.length === 0
                ? "nothing to print yet"
                : `prints ${paragraphs.length} paragraph${paragraphs.length === 1 ? "" : "s"}`}
            </span>
            <span className="abt-go">edit <IconArrowRight size={11} className="nudge" /></span>
          </a>

          <a className="abt-l" href="#abt-edu">
            <span className="cmd-prompt" aria-hidden="true">➜</span>
            <span>education</span>
            <span className="abt-out">
              <span className="abt-arrow" aria-hidden="true">→ </span>
              {education.length === 0
                ? "the jump target is missing — the command is dropped"
                : `scrolls to ${education.length} entr${education.length === 1 ? "y" : "ies"}`}
            </span>
            <span className="abt-go">edit <IconArrowRight size={11} className="nudge" /></span>
          </a>

          <Link className="abt-l" href="/hero">
            <span className="cmd-prompt" aria-hidden="true">➜</span>
            <span>resume</span>
            <span className="abt-out">
              <span className="abt-arrow" aria-hidden="true">→ </span>
              {resumeHost ? `opens ${resumeHost}` : "no URL set — falls back to the built-in link"}
            </span>
            <span className="abt-go">hero <IconArrowRight size={11} className="nudge" /></span>
          </Link>

          <Link className="abt-l" href="/terminal">
            <span className="cmd-prompt" aria-hidden="true">➜</span>
            <span>help</span>
            <span className="abt-out">
              <span className="abt-arrow" aria-hidden="true">→ </span>
              lists {discoverable} of {TERMINAL_COMMANDS.length} commands
            </span>
            <span className="abt-go">reference <IconArrowRight size={11} className="nudge" /></span>
          </Link>

          <div className="abt-l abt-l-static">
            <span className="cmd-prompt" aria-hidden="true">➜</span>
            <span className="abt-caret" aria-hidden="true" />
            <span className="sr-only">Prompt, waiting for the visitor.</span>
          </div>
        </div>
      </div>

      <div className="abt-stag">
        <section className="abt-blk abt-anchor" id="abt-bio">
          <BlockHead n="01" title="Bio paragraphs">
            The output of <code>whoami</code>, printed one paragraph at a time when the section
            scrolls into view. Order here is print order.
          </BlockHead>
          <AboutParagraphsTable
            paragraphs={paragraphs.map(p => ({ id: p.id, content: p.content, sortOrder: p.sortOrder }))}
          />
        </section>

        <section className="abt-blk abt-anchor" id="abt-edu">
          <BlockHead n="02" title="Education">
            The dashed timeline under the terminal, and the landing point for the
            terminal&rsquo;s <code>education</code> command. Scores are optional and render as rings.
          </BlockHead>
          <EducationTable
            entries={education.map(e => ({
              id: e.id, institution: e.institution, location: e.location, degree: e.degree,
              scoreType: e.scoreType, score: e.score, scoreTotal: e.scoreTotal,
              startYear: e.startYear, endYear: e.endYear, sortOrder: e.sortOrder,
            }))}
          />
        </section>

        <section className="abt-blk abt-anchor" id="abt-borrowed">
          <BlockHead n="03" title="Edited elsewhere">
            About draws these but does not own them: <code>resume</code> and <code>cv</code> open
            the résumé URL, and a bolded company name — <code>**Acme**</code> — draws that
            company&rsquo;s mark inline. One value, one owning section, so neither is an input here
            that could race its real writer.
          </BlockHead>
          <Card flush>
            <CardHead
              title="Borrowed values"
              count={2}
              right={<span className="hint"><IconLock size={12} stroke={1.7} /> read-only on this page</span>}
            />
            <div className="rows">
              <Borrowed
                label="resumeUrl"
                value={resumeHost ? `the terminal's resume / cv command opens ${resumeHost}` : ""}
                empty="not set — resume falls back to the link built into the site"
                owner="Hero"
                href="/hero"
              />
              <Borrowed
                label="Experience · logoUrl"
                value={
                  experiences.length === 0
                    ? ""
                    : `${withLogo} of ${experiences.length} experience row${experiences.length === 1 ? "" : "s"} carr${withLogo === 1 ? "ies" : "y"} a mark`
                }
                empty="no experience rows yet, so no marks to draw"
                owner="Experience"
                href="/experiences"
              />
            </div>
          </Card>
        </section>

        <StagedAboutPreview
          paragraphs={paragraphs.map(p => ({ id: p.id, content: p.content }))}
          experiences={experiences}
          education={education.map(e => ({
            id: e.id,
            institution: e.institution,
            degree: e.degree,
            location: e.location,
            scoreType: e.scoreType,
            score: e.score,
            scoreTotal: e.scoreTotal,
            startYear: e.startYear,
            endYear: e.endYear,
          }))}
          label="About — bio, terminal & education"
        />
      </div>

      <div className="abt-foot">
        <IconTerminal2 size={13} stroke={1.6} aria-hidden="true" />
        <span>
          The shell itself — every command, what it prints, which keys it captures — is
          documented on <Link href="/terminal" className="abt-foot-l">the terminal reference</Link>.
          It has no model behind it and nothing there is editable.
        </span>
      </div>
    </div>
  );
}
