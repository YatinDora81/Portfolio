"use client";

import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStaging } from "@/components/staging/staging-provider";
import { useLiveVersion, type HeroContentRow } from "@/components/staging/hero-live";
import { cn } from "@/lib/utils";
import { IconAlertTriangle, IconWorldUpload } from "@tabler/icons-react";

export type Version = "v1" | "v2";

export interface VersionCounts {
  titles: number;
  badges: number;
  socials: number;
}

/**
 * Card 01 — the hero has two whole layouts and exactly one of them ships.
 *
 * The old control was a pair of `.filt` pills that had to carry two unrelated
 * facts at once: which version you are editing, and which one visitors get.
 * They are separated here — the tile you pick is the tab, the `live` chip is the
 * site — because the dangerous action on this page is flipping the second while
 * thinking about the first.
 *
 * The flip is staged, not written: it lands in the same batch as the rows it
 * depends on, so a version can never go live a save before its own titles do.
 */
export function HeroVersionCard({ content, version, onPick, counts, blockedReason }: {
  content: HeroContentRow[];
  version: Version;
  onPick: (v: Version) => void;
  counts: Record<Version, VersionCounts>;
  /** Set when the shown version isn't servable; disables the flip and says why. */
  blockedReason?: string;
}) {
  const { stageUpdate, clearUpdate, saving } = useStaging();
  const liveVersion = useLiveVersion(content);
  const server = content.find((c) => c.version === version);

  const flip = () => {
    if (!server) return;
    // Clear both rows first so exactly one live op can exist — that invariant is
    // what makes `useLiveVersion` exact, and it also means flipping back to the
    // saved version stages nothing at all instead of a no-op update.
    for (const c of content) clearUpdate("heroContent", c.id, ["live"]);
    if (content.find((c) => c.live)?.version !== version) {
      stageUpdate("heroContent", server.id, { live: true });
    }
  };

  const isLive = liveVersion === version;

  return (
    <Card flush>
      <CardHead
        title="Version"
        right={
          isLive ? (
            <span className="chip on"><span className="dot" aria-hidden="true" />{version} is what visitors get</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={flip}
              disabled={saving || !server || Boolean(blockedReason)}
              title={blockedReason}
            >
              <IconWorldUpload size={14} stroke={1.8} /> Serve {version} to visitors
            </Button>
          )
        }
      />

      <div className="hro-vers" role="radiogroup" aria-label="Hero version to edit">
        {(["v1", "v2"] as const).map((v) => {
          const c = counts[v];
          const live = liveVersion === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={version === v}
              className={cn("hro-ver", version === v && "on")}
              onClick={() => onPick(v)}
            >
              <span className="hro-ver-k">{v}</span>
              <span className="hro-ver-m">
                <span className={cn("hro-ver-st", live && "live")}>
                  {live ? "live on the site" : "draft — nobody sees this"}
                </span>
                <span className="hro-ver-c">
                  {c.titles} role {c.titles === 1 ? "title" : "titles"} · {c.badges}{" "}
                  {c.badges === 1 ? "badge" : "badges"} · {c.socials} social
                </span>
              </span>
              {/* Not a second control: it repeats the tile's own state for a
                  reader scanning the right edge, where the flip button sits. */}
              {live && <span className="dot" aria-hidden="true" style={{ background: "var(--good)" }} />}
            </button>
          );
        })}
      </div>

      {blockedReason && (
        <div className="hro-warn">
          <IconAlertTriangle size={14} stroke={1.7} style={{ flex: "none" }} />
          <span>{blockedReason}</span>
        </div>
      )}
    </Card>
  );
}
