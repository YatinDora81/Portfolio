import { prisma } from "db";
import { IconArrowUpRight } from "@tabler/icons-react";
import { PageHeader } from "@/components/shared/page-header";
import { configValues, keysFor } from "@/lib/site-config-keys";
import { BackgroundConsole } from "./layer-card";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in").replace(/\/+$/, "");

export default async function BackgroundPage() {
  const settings = await prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } });

  const values = configValues(settings);
  const version = settings.backgroundVersion;
  const terrain = Object.fromEntries(
    keysFor("background")
      .filter((k) => k !== "backgroundVersion")
      .map((k) => [k, values[k]])
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
