import { prisma } from "db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHead } from "@/components/ui/card";
import { CatConsole } from "./cat-console";
import {
  IconArrowNarrowDown, IconArrowUpRight, IconPaw, IconTerminal2,
} from "@tabler/icons-react";

/**
 * The cat.
 *
 * Two SiteConfig rows are the whole of what an editor can change — `catNapStyle`
 * and `catNapSeconds`. Everything else the cat does lives in apps/web code, so
 * the rest of this page documents rather than pretends: no control here drives
 * anything it cannot actually write.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/+$/, "");

/** apps/web falls back to exactly these when the row is missing, so a blank
    database still shows what the site is really serving. */
const DEFAULTS = { catNapStyle: "ticks", catNapSeconds: "30" };

/** The four cat surfaces with nothing behind them to edit. */
const SURFACES = [
  {
    glyph: <IconPaw size={15} stroke={1.7} />,
    title: "The paw in the navbar",
    body: "Shoos the cat away and brings it back. A new visitor always gets the cat ON; the choice is only remembered once they press it, and it is remembered in their browser, not here.",
    where: "CatProvider.tsx · localStorage showCat",
  },
  {
    glyph: <span className="cat-glyph-t">^..^</span>,
    title: "The cat on the wire",
    body: "=^..^= sits on the hairline divider between Hero and About — the reason this page sits between those two in the sidebar. Shoo the cat and it hops off, leaving a plain interpunct on the wire.",
    where: "Bridge.tsx · #bridge",
  },
  {
    glyph: <IconArrowNarrowDown size={15} stroke={1.7} />,
    title: "The paw-print scroll cue",
    body: "Three prints under the hero, walking down to About on a 2.6s opacity loop. They are a link, not decoration — clicking them scrolls to the About section.",
    where: "Hero.tsx · .cue",
  },
  {
    glyph: <IconTerminal2 size={15} stroke={1.7} />,
    title: "cat, in the About terminal",
    body: "Typing cat answers “the cat is in the navbar, not in the terminal”. It is an easter egg, so it never appears in help, ls or Tab-completion.",
    where: "packages/ui/terminal.ts · kind: egg",
  },
];

/** Facts that stop this page overstating its own reach. */
const FACTS = [
  {
    k: "desktop only",
    v: <>The script never loads below 1025px wide — <code>OnekoCat</code> returns null. Phones and small tablets get the wire cat and the paw prints, and no chasing cat at all.</>,
  },
  {
    k: "visitor's choice",
    v: <>Whether the cat is shown is a per-visitor toggle stored in their browser under <code>showCat</code>. There is no setting here that can force it on for everyone.</>,
  },
  {
    k: "remembers where",
    v: <>Wherever a visitor drops the cat is saved to their browser under <code>oneko-pos</code>, so it wakes up in the same corner on their next visit.</>,
  },
  {
    k: "the nap zone",
    v: <>Fixed at 64px from any window edge (<code>data-nap-edge</code>). Not exposed by <code>OnekoCat</code> and not a SiteConfig key — reference only.</>,
  },
  {
    k: "reduced motion",
    v: <>A visitor who asks their system for reduced motion gets no chasing cat at all: <code>oneko.js</code> returns before it draws anything. The nap style is moot for them.</>,
  },
];

export default async function CatPage() {
  const configs = await prisma.siteConfig.findMany({
    where: { key: { in: ["catNapStyle", "catNapSeconds"] } },
  });
  const map = Object.fromEntries(configs.map(c => [c.key, c.value]));

  return (
    <div className="view">
      <PageHeader
        eyebrow="the cat · a layer over the page"
        title="Cat"
        description="A cat follows the pointer around the portfolio, and falls asleep wherever you drop it near an edge. Two things about it are yours to set; the rest is here so you know what it does."
      />

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">^..^</span>
        <div className="sec-anchor">
          <span>no anchor — the cat runs over every section</span>
          <a href={`${SITE_URL}/#about`} target="_blank" rel="noreferrer" className="nudge-wrap">
            see it on the wire <IconArrowUpRight size={11} className="nudge" />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">rides the hero ↔ about divider</span>
          <span className="chip">desktop only</span>
        </div>
      </div>

      <CatConsole
        napStyle={map["catNapStyle"] || DEFAULTS.catNapStyle}
        napSeconds={map["catNapSeconds"] || DEFAULTS.catNapSeconds}
      >
        <Card flush>
          <CardHead
            title="Where else the cat shows up"
            count={SURFACES.length}
            right={<span className="hint">nothing here is editable</span>}
          />
          <div className="rows cat-surf">
            {SURFACES.map(s => (
              <div className="row" key={s.title}>
                <span className="cat-glyph" aria-hidden>{s.glyph}</span>
                <div className="row-main">
                  <div className="row-t">{s.title}</div>
                  <div className="row-m">{s.body}</div>
                  <div className="cat-where">{s.where}</div>
                </div>
                <span className="cat-tag">no setting — lives in the site&rsquo;s code</span>
              </div>
            ))}
          </div>
        </Card>

        <Card flush>
          <CardHead title="Facts about the cat" count={FACTS.length} />
          <dl className="cat-facts">
            {FACTS.map(f => (
              <div className="cat-fact" key={f.k}>
                <dt>{f.k}</dt>
                <dd>{f.v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </CatConsole>
    </div>
  );
}
