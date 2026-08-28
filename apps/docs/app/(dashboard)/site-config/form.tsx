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
  label: string;
  value: string;
  owner: string;
  href: string;
}

const WHERE: Record<string, string> = {
  Navbar: "top of every page",
  Footer: "bottom of every page",
  "Site-wide": "no surface declared",
  Unclaimed: "safety net — no section owns these",
};

export function SiteChromeForm({
  chromeKeys,
  unclaimedKeys,
  values,
  moved,
  hasBlogs,
  sections,
}: {
  chromeKeys: string[];
  unclaimedKeys: string[];
  values: Record<string, string>;
  moved: MovedRow[];
  hasBlogs: boolean;
  sections: Record<NavSection, boolean>;
}) {
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
