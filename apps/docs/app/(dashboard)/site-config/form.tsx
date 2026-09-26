"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { ConfigCard, type ConfigGroup } from "@/components/config/config-card";
import { Borrowed } from "@/components/shared/borrowed";
import { PreviewFrame } from "@/components/preview";
import { ChromePreview, type NavSection } from "./chrome-preview";

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
};

export function SiteChromeForm({
  chromeKeys,
  values,
  moved,
  hasBlogs,
  sections,
}: {
  chromeKeys: string[];
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
    return out;
  }, [chromeKeys]);

  return (
    <>
      <div className="grid gap-3">
        <ConfigCard
          groups={groups}
          values={values}
          onDraftChange={onDraftChange}
          heading={g => (
            <div className="wk-cut" style={g === groups[0] ? { marginTop: 0 } : undefined}>
              {g.n ? `${g.n} ·` : "·"}
              <span className="n">{WHERE[g.title] ?? g.title.toLowerCase()}</span>
            </div>
          )}
        />

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
