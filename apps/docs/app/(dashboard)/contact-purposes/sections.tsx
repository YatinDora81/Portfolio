"use client";

import { useCallback, useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { StagedContactPreview } from "@/components/preview/staged";
import { ConfigCard, type ConfigGroup } from "@/components/config/config-card";
import { Borrowed } from "@/components/shared/borrowed";
import { ContactPurposesTable } from "./table";

interface Purpose { id: string; label: string; emoji: string; sortOrder: number }
interface Social { id: string; name: string; iconKey: string; detail: string | null }

/**
 * The whole contact section on one screen:
 *
 *   01 Purpose chips · 02 The address · 03 Availability · 04 The dial · preview
 *
 * Two save affordances, never ambiguous: the chips stage into the global save
 * bar and show nothing local, the three SiteConfig keys write through
 * ConfigCard's own footer and say so there.
 *
 * `availabilityStatus` and `availabilityDetail` are one card on purpose. They
 * are one message split across two places on the site — the caption under the
 * oscilloscope and the note beside the transmit button — and editing either
 * alone is how they end up contradicting each other.
 */
export function ContactSections({
  purposes, socialLinks, config, resumeUrl, githubTile,
}: {
  purposes: Purpose[];
  socialLinks: Social[];
  /** Exactly the SiteConfig keys this section owns — the ConfigCard payload. */
  config: Record<string, string>;
  /** Owned by Hero; the dial's tape row reads it, so the pane needs it. */
  resumeUrl: string;
  /** Server-rendered: the tile reads the archive, which is a database call. */
  githubTile: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(config);
  const onDraftChange = useCallback((v: Record<string, string>) => setDraft(v), []);

  const groups: ConfigGroup[] = [
    {
      n: "02",
      title: "The address",
      blurb: "The whole section is built around it. Empty and the site draws no address, no carrier wave and no mailto.",
      keys: ["contactEmail"],
    },
    {
      n: "03",
      title: "Availability",
      blurb: "One message in two places: the caption on the instrument, and the line beside the transmit button.",
      keys: ["availabilityStatus", "availabilityDetail"],
      slot: (
        <div className="ctc-mirror">
          The status is also the hero&rsquo;s availability pill — the dot beside it is set on Hero.
        </div>
      ),
    },
  ];

  const names = socialLinks.map((l) => l.name).filter(Boolean);
  const summary = names.length
    ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`
    : "";

  return (
    <div className="ctc-page">
      <Block n="01" title="Purpose chips" note="What a visitor says they're here about." />
      <ContactPurposesTable purposes={purposes} />

      <ConfigCard
        groups={groups}
        values={config}
        onDraftChange={onDraftChange}
        heading={(g) => <Block n={g.n ?? ""} title={g.title} />}
      />

      <Block n="04" title="The dial" note="Everything under the address — GitHub first, then the rest." />
      {githubTile}
      <Card flush>
        <CardHead title="Rows on the dial" />
        <Borrowed
          label="social row"
          value={summary}
          empty="no links — the whole dial is skipped"
          owner="Hero"
          href="/hero"
        />
      </Card>

      <StagedContactPreview
        purposes={purposes.map((p) => ({ id: p.id, label: p.label, emoji: p.emoji }))}
        socialLinks={socialLinks.map((l) => ({ id: l.id, name: l.name, iconKey: l.iconKey, detail: l.detail }))}
        availabilityStatus={draft["availabilityStatus"] ?? ""}
        availabilityDetail={draft["availabilityDetail"] ?? ""}
        contactEmail={draft["contactEmail"] ?? ""}
        resumeUrl={resumeUrl}
        label="Contact — the open channel"
      />
    </div>
  );
}

/** Same numbered rhythm as the Hero page — one rule set, two prefixes. */
function Block({ n, title, note }: { n: string; title: string; note?: string }) {
  return (
    <div className="ctc-blk">
      <span className="ctc-blk-n">{n}</span>
      <h2 className="ctc-blk-t">{title}</h2>
      {note && <span className="ctc-blk-m">{note}</span>}
      <i aria-hidden="true" />
    </div>
  );
}
