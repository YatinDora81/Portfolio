"use client";

import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStaging } from "@/components/staging/staging-provider";
import { useLiveVersion, type HeroContentRow } from "@/components/staging/hero-live";
import { IconCheck, IconWorldUpload } from "@tabler/icons-react";

type Version = "v1" | "v2";

export function HeroCopyCard({ content, version, flipBlockedReason }: {
  content: HeroContentRow[];
  /** Owned by HeroSections — the copy, titles and badges edit the same hero. */
  version: Version;
  /** Set when this version isn't servable yet; disables the flip and says why. */
  flipBlockedReason?: string;
}) {
  const { overlay, stageUpdate, clearUpdate, saving } = useStaging();
  const liveVersion = useLiveVersion(content);

  const server = content.find((c) => c.version === version);
  // Rendered from the overlay rather than local state, like every other staged
  // surface. Holding it locally would survive the save bar's Discard, leaving a
  // textarea showing text the store had already thrown away.
  const row = overlay("heroContent", content, (c) => c.id).find((c) => c.version === version);

  if (!server || !row) {
    return (
      <Card flush>
        <CardHead title="Hero copy" />
        <div className="card-b">
          <div className="f-hint">
            No {version} row in the database. Run the {version} migration, then reload.
          </div>
        </div>
      </Card>
    );
  }

  const edit = (key: "intro" | "tagline", next: string) => {
    // Typing back to what the database holds is not a change. Without the clear,
    // stageUpdate would leave an op behind and the bar would claim an edit that
    // no longer exists.
    if (next === server[key]) clearUpdate("heroContent", server.id, [key]);
    else stageUpdate("heroContent", server.id, { [key]: next });
  };

  const isLive = liveVersion === version;
  const flip = () => {
    // Clear both rows first so exactly one live op can exist — that invariant is
    // what makes `useLiveVersion` exact, and it also means flipping back to the
    // saved version stages nothing at all instead of a no-op update.
    for (const c of content) clearUpdate("heroContent", c.id, ["live"]);
    if (content.find((c) => c.live)?.version !== version) {
      stageUpdate("heroContent", server.id, { live: true });
    }
  };

  return (
    <Card flush>
      <CardHead
        title="Hero copy"
        right={
          isLive ? (
            <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <IconCheck size={13} stroke={2} />
              {version} is live
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={flip}
              disabled={saving || Boolean(flipBlockedReason)}
              title={flipBlockedReason}
            >
              <IconWorldUpload size={14} stroke={1.8} /> Serve {version} to visitors
            </Button>
          )
        }
      />
      <div className="card-b" style={{ paddingBottom: 2 }}>
        <Textarea
          label="Intro"
          rows={3}
          value={row.intro}
          onChange={(e) => edit("intro", e.target.value)}
          disabled={saving}
          hint={
            version === "v1"
              ? "The bio sentence — the skill chips are drawn inside it, then the tagline closes it."
              : "The standalone paragraph above the skill pills."
          }
        />
        <Textarea
          label="Tagline"
          rows={3}
          value={row.tagline}
          onChange={(e) => edit("tagline", e.target.value)}
          disabled={saving}
          hint={
            version === "v1"
              ? "Ends the bio sentence."
              : "The italic voice line on its own, under the intro."
          }
        />
        {/* Rendered on the live tab too: a version that is already serving and
            has just lost its last title is the case that actually reaches
            visitors, and gating this on `!isLive` hid exactly that one. */}
        {flipBlockedReason && (
          <div className="f-hint" style={{ color: "var(--bad)" }}>{flipBlockedReason}</div>
        )}
      </div>
    </Card>
  );
}
