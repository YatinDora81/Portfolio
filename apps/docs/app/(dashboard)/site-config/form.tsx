"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { ConfigCard, type ConfigGroup } from "@/components/config/config-card";
import { Borrowed } from "@/components/shared/borrowed";
import { PreviewFrame } from "@/components/preview";
import { ChromePreview, type NavSection } from "./chrome-preview";
import type { ConfigKeyDef } from "@/lib/site-config-keys";
import { IconAlertTriangle } from "@tabler/icons-react";

interface MovedRow {
  key: string;
  /** The key's own name in the registry — "Dot colour", not "heroDotColor". */
  label: string;
  value: string;
  /** The section that writes it now. */
  owner: string;
  href: string;
}

/** Where each card's rows actually appear, in the visitor's terms. */
const WHERE: Record<string, string> = {
  Navbar: "top of every page",
  Footer: "bottom of every page",
  "Site-wide": "no surface declared",
  Unclaimed: "safety net — no section owns these",
};

/**
 * Two owned rows, one save, and the safety net.
 *
 * The editing itself is `ConfigCard`, which posts ONLY the keys it is given —
 * that is the property the whole four-page SiteConfig split rests on, so this
 * page hands it `chromeKeys` plus whatever the database holds that no section
 * claims, and nothing else.
 */
export function SiteChromeForm({
  chromeKeys,
  unclaimedKeys,
  values,
  moved,
  hasBlogs,
  sections,
}: {
  chromeKeys: string[];
  /** DB rows absent from the registry. Editable here so nothing is orphaned. */
  unclaimedKeys: string[];
  values: Record<string, string>;
  moved: MovedRow[];
  hasBlogs: boolean;
  /** Passed straight through: the preview draws the navbar, so it owns the rule. */
  sections: Record<NavSection, boolean>;
}) {
  // The preview follows the fields as they are typed rather than after a save,
  // which is the only way "does this wordmark fit" is answerable here.
  const [draft, setDraft] = useState(values);
  const onDraftChange = useCallback((next: Record<string, string>) => setDraft(next), []);

  const groups = useMemo<ConfigGroup[]>(() => {
    const out: ConfigGroup[] = [];
    if (chromeKeys.includes("navbarLogo")) {
      out.push({
        n: "01",
        title: "Navbar",
        blurb: "Top left of every page, including /blog. The section links and the two toggles beside it are code, not config.",
        keys: ["navbarLogo"],
      });
    }
    if (chromeKeys.includes("copyrightName")) {
      out.push({
        n: "02",
        title: "Footer",
        blurb: "Sets both the copyright line and the giant name mark bleeding off the bottom of the page.",
        keys: ["copyrightName"],
      });
    }
    const rest = chromeKeys.filter(k => k !== "navbarLogo" && k !== "copyrightName");
    if (rest.length) out.push({ title: "Site-wide", keys: rest });
    if (unclaimedKeys.length) {
      out.push({
        title: "Unclaimed",
        blurb: "These rows exist in SiteConfig but no section claims them. They stay editable here so nothing can be orphaned — give them an owner in app/lib/site-config-keys.ts.",
        keys: unclaimedKeys,
      });
    }
    return out;
  }, [chromeKeys, unclaimedKeys]);

  // Minimal definitions for rows the registry has never heard of. Plain text,
  // because we cannot know what the value means — but editable, which is the
  // entire point of the net.
  const extraDefs = useMemo<Record<string, ConfigKeyDef>>(
    () => Object.fromEntries(unclaimedKeys.map(k => [k, {
      owner: "chrome" as const,
      control: "mono" as const,
      label: k,
      description: "No section owns this key — it is edited here until one does.",
    }])),
    [unclaimedKeys]
  );

  return (
    <>
      <div className="grid gap-3">
        <ConfigCard
          groups={groups}
          values={values}
          extraDefs={extraDefs}
          onDraftChange={onDraftChange}
          heading={g => (
            <div className="wk-cut" style={g === groups[0] ? { marginTop: 0 } : undefined}>
              {g.n ? `${g.n} ·` : "·"}
              <span className="n">{WHERE[g.title] ?? g.title.toLowerCase()}</span>
            </div>
          )}
        />

        {unclaimedKeys.length > 0 && (
          <div className="hint" style={{ lineHeight: 1.55 }}>
            <IconAlertTriangle size={13} style={{ flexShrink: 0 }} />
            <span>
              {unclaimedKeys.length} unclaimed {unclaimedKeys.length === 1 ? "row" : "rows"} in
              SiteConfig. Nothing is lost — but a key with no owner has no section that explains
              what it does.
            </span>
          </div>
        )}

        {/* Where the other nine keys went. Read-only by design: one row with two
            writers is exactly the race the split was made to avoid. */}
        <Card flush>
          <CardHead
            title="Edited elsewhere"
            count={moved.length}
            right={<span className="hint">one key, one section</span>}
          />
          <div>
            {moved.map(m => (
              <Borrowed
                key={m.key}
                label={m.label}
                value={m.value}
                owner={m.owner}
                href={m.href}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Not a hero any more: this page holds the frame around the page, so the
          preview draws that frame. Bare `PreviewFrame` on purpose — there is no
          staged entity behind chrome, so a Staged* wrapper's pending-change chip
          would read zero forever while the card above is dirty. */}
      <PreviewFrame label="Chrome — navbar and footer">
        <ChromePreview
          logo={draft["navbarLogo"] ?? ""}
          copyrightName={draft["copyrightName"] ?? ""}
          hasBlogs={hasBlogs}
          sections={sections}
        />
      </PreviewFrame>
    </>
  );
}
