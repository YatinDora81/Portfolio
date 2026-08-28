import { prisma } from "db";
import { IconArrowUpRight } from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { DEFAULTS, keysFor, toBackgroundVersion } from "@/lib/site-config-keys";
import { BackgroundConsole } from "./layer-card";

/**
 * The layer under the page.
 *
 * Every other page in the "top to bottom" run owns a band a visitor scrolls to.
 * This one owns what is drawn before any of them, on all five pages that render
 * a background — the portfolio, both blog pages, the 404 and the error page —
 * which is why it carries a glyph instead of an ordinal and why its reach chips
 * say so out loud.
 *
 * Nine rows, and only one of them is unconditional: the eight terrain dials are
 * read by nothing at all while `backgroundVersion` is v1.
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/+$/, "");

export default async function BackgroundPage() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: keysFor("background") } },
  });

  const cfg = new Map(rows.map((r) => [r.key, r.value]));
  // Coerced here as well as on write, so a row edited around the action still
  // shows the layer visitors are actually being served.
  const version = toBackgroundVersion(cfg.get("backgroundVersion") ?? DEFAULTS["backgroundVersion"]);
  // Exactly the keys this section owns, minus the one the tiles hold — the two
  // cards below post separately, and ConfigCard posts what it is handed.
  const terrain = Object.fromEntries(
    keysFor("background")
      .filter((k) => k !== "backgroundVersion")
      .map((k) => [k, cfg.get(k) ?? DEFAULTS[k] ?? ""])
  );

  return (
    <div className="view">
      <PageHeader
        eyebrow="the background · a layer under the page"
        title="Background"
        description="What is drawn behind every section, before any of them: fifty ruled lines, or a contour map that flows under the pointer and holds still while you read. The layer is one row; the eight dials under it only matter while the map is the one drawing."
      />

      <div className="sec-strip">
        <span className="sec-mark" aria-hidden="true">~~~</span>
        <div className="sec-anchor">
          <span>no anchor — the field is behind all eight sections</span>
          <a href={SITE} target="_blank" rel="noreferrer">
            open the site <IconArrowUpRight size={11} className="nudge" />
          </a>
        </div>
        <div className="sec-reach">
          <span className="chip">also under /blog, the 404 and the error page</span>
          <span className="chip">below 1024px v1 drops its beams, v2 is not drawn at all</span>
        </div>
      </div>

      <BackgroundConsole version={version} terrain={terrain} />
    </div>
  );
}
