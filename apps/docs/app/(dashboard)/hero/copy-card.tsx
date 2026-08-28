"use client";

import { Card, CardHead } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useStaging } from "@/components/staging/staging-provider";
import { type HeroContentRow } from "@/components/staging/hero-live";

type Version = "v1" | "v2";

export function HeroCopyCard({ content, version }: {
  content: HeroContentRow[];
  version: Version;
}) {
  const { overlay, stageUpdate, clearUpdate, saving } = useStaging();

  const server = content.find((c) => c.version === version);
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
