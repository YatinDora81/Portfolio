"use client";

import { Card, CardHead } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useStaging } from "@/components/staging/staging-provider";
import { type HeroContentRow } from "@/components/staging/hero-live";

type Version = "v1" | "v2";

/**
 * The prose half of the hero. The flip that decides which version ships used to
 * live in this card's header; it belongs to card 01 now, next to the tiles that
 * say what each version currently holds — a publish decision and a text edit
 * should not share a header strip.
 */
export function HeroCopyCard({ content, version }: {
  content: HeroContentRow[];
  /** Owned by HeroSections — the copy, titles and badges edit the same hero. */
  version: Version;
}) {
  const { overlay, stageUpdate, clearUpdate, saving } = useStaging();

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

  return (
    <Card flush>
      <CardHead title="Hero copy" right={<span className="hro-scope">editing {version}</span>} />
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
      </div>
    </Card>
  );
}
