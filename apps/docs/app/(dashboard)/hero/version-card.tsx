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

export function HeroVersionCard({ content, version, onPick, counts, blockedReason }: {
  content: HeroContentRow[];
  version: Version;
  onPick: (v: Version) => void;
  counts: Record<Version, VersionCounts>;
  blockedReason?: string;
}) {
  const { stageUpdate, clearUpdate, saving } = useStaging();
  const liveVersion = useLiveVersion(content);
  const server = content.find((c) => c.version === version);

  const flip = () => {
    if (!server) return;
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
