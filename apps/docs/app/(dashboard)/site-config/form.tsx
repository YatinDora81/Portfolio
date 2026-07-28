"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PreviewFrame, HeroPreview } from "@/components/preview";
import { updateSiteConfig } from "@/lib/actions/site-config";
import { publishSite } from "@/lib/actions/publish";
import {
  IconAlertTriangle, IconArrowBackUp, IconCheck, IconDeviceFloppy, IconWorldUpload,
} from "@tabler/icons-react";

interface ConfigEntry { key: string; label: string; description: string; value: string }

type HeroVersion = "v1" | "v2";

/** One version's slice of the three tables the hero draws. */
interface HeroRows {
  titles: string[];
  skills: { name: string }[];
  socialLinks: { name: string; iconKey?: string }[];
}

const VERSION_OPTIONS = [
  { value: "v1", label: "v1 — chips inside the sentence, Resume first" },
  { value: "v2", label: "v2 — voice line and pill row, Get in touch first" },
];

/**
 * Presentation only — which card a key lands in and how wide it renders.
 * Keys missing from here still render (in a trailing "Other" card), so the
 * form can never silently drop a SiteConfig row.
 */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Identity", keys: ["name", "navbarLogo", "avatarUrl", "copyrightName"] },
  { title: "Hero copy", keys: ["intro", "tagline", "introV2", "taglineV2"] },
  { title: "Contact & availability", keys: ["contactEmail", "availabilityStatus", "availabilityDetail"] },
];
/** Sentence-length copy — gets a full-width textarea. */
const LONG = new Set(["intro", "tagline", "introV2", "taglineV2", "availabilityDetail"]);
/** URLs / addresses — mono face. */
const MONO = new Set(["avatarUrl", "contactEmail"]);

export function SiteConfigForm({
  configs,
  heroVersion,
  hero,
  photos,
  totalSkills,
}: {
  configs: ConfigEntry[];
  heroVersion: string;
  hero: Record<HeroVersion, HeroRows>;
  photos: string[];
  /** Drives v2's "+N more" chip — the Skills section's visible row count. */
  totalSkills?: number;
}) {
  // `heroVersion` is not a CONFIG_KEYS entry — it rides in the same state so the
  // dirty flag, Reset and both save buttons cover it without a second code path.
  const initial = useMemo(
    () => ({ ...Object.fromEntries(configs.map(c => [c.key, c.value])), heroVersion }),
    [configs, heroVersion]
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [base, setBase] = useState<Record<string, string>>(initial);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);

  const dirty = Object.keys(values).some(k => (values[k] ?? "") !== (base[k] ?? ""));

  // Saving stopped publishing when `revalidatePortfolio()` left the actions, and
  // the public page holds its render for a day (`revalidate = 86400`). Without
  // this button a renamed site looks saved here and stays stale out there, with
  // nothing on the page saying a second, separate action is needed.
  const handleSave = (publish: boolean) => {
    setBusy(publish ? "publish" : "save");
    setPubError(null);
    startTransition(async () => {
      try {
        const snapshot = values;
        await updateSiteConfig(Object.entries(snapshot).map(([key, value]) => ({ key, value })));
        setBase(snapshot);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        if (publish) {
          // Decision 5: the config is saved. A publish that fails is a separate,
          // retryable failure — it never undoes the write.
          const res = await publishSite();
          if (!res.ok) setPubError(res.error ?? "Could not reach the site.");
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const set = (key: string, value: string) => setValues(prev => ({ ...prev, [key]: value }));

  const field = (c: ConfigEntry) =>
    LONG.has(c.key) ? (
      <Textarea
        key={c.key}
        label={c.label}
        hint={c.description}
        rows={3}
        value={values[c.key] ?? ""}
        onChange={e => set(c.key, e.target.value)}
      />
    ) : (
      <Input
        key={c.key}
        label={c.label}
        hint={c.description}
        mono={MONO.has(c.key)}
        value={values[c.key] ?? ""}
        onChange={e => set(c.key, e.target.value)}
      />
    );

  /** Short fields pair up into `.f-row`; long ones break the row and go full width. */
  const fields = (entries: ConfigEntry[]) => {
    const out: React.ReactNode[] = [];
    let buf: ConfigEntry[] = [];
    const flush = () => {
      while (buf.length) {
        const pair = buf.slice(0, 2);
        buf = buf.slice(2);
        out.push(
          <div className="f-row" key={pair.map(p => p.key).join("+")}>
            {pair.map(field)}
          </div>
        );
      }
    };
    for (const c of entries) {
      if (LONG.has(c.key)) { flush(); out.push(field(c)); }
      else buf.push(c);
    }
    flush();
    return out;
  };

  const byKey = new Map(configs.map(c => [c.key, c]));
  const grouped = new Set(GROUPS.flatMap(g => g.keys));
  const cards = GROUPS
    .map(g => ({ title: g.title, entries: g.keys.map(k => byKey.get(k)).filter(Boolean) as ConfigEntry[] }))
    .filter(g => g.entries.length > 0);
  const leftovers = configs.filter(c => !grouped.has(c.key));
  if (leftovers.length) cards.push({ title: "Other", entries: leftovers });

  const version: HeroVersion = values.heroVersion === "v1" ? "v1" : "v2";
  // Same fallback chain as apps/web/app/lib/data.ts: v2 borrows v1's copy while
  // its own row is blank, so the preview shows what would actually ship.
  const intro = version === "v2" ? values.introV2 || values.intro || "" : values.intro || "";
  const tagline = version === "v2" ? values.taglineV2 || values.tagline || "" : values.tagline || "";
  const rows = hero[version];

  return (
    <>
      <div className="grid gap-3">
        {/* Its own card rather than a CONFIG_KEYS entry: the generic renderer only
            knows textarea-or-input and pairs short fields up, so this would read as
            a half-width string field beside an unrelated one. */}
        <Card flush>
          <CardHead title="Hero version" />
          <div className="card-b" style={{ paddingBottom: 2 }}>
            <div className="ico-warn">
              <IconAlertTriangle size={16} stroke={1.8} style={{ flex: "none", marginTop: 1 }} />
              <div>
                <b>This switch saves on its own, and only from here</b>
                Hero titles, skill badges and social links stage in the save bar at the top of the
                screen; this page saves through the buttons at the bottom. Publishing a flip while
                those are still staged serves the new hero against the old rows — commit the save bar
                first. Save before leaving this page, too: unsaved changes here are not kept.
              </div>
            </div>
            <Select
              label="Version on the live site"
              hint="Which hero layout the public page renders."
              value={version}
              onChange={e => set("heroVersion", e.target.value)}
              options={VERSION_OPTIONS}
            />
          </div>
        </Card>

        {cards.map(g => (
          <Card flush key={g.title}>
            <CardHead title={g.title} count={g.entries.length} />
            <div className="card-b" style={{ paddingBottom: 2 }}>
              {fields(g.entries)}
            </div>
          </Card>
        ))}

        {pubError && (
          <div className="hint" style={{ color: "var(--bad)", lineHeight: 1.5 }}>
            <IconAlertTriangle size={14} stroke={1.6} style={{ flexShrink: 0 }} />
            <span>The changes are saved. Publishing failed ({pubError}) — retry with Publish, top right.</span>
          </div>
        )}

        <div className="row-acts" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {saved && !pubError && (
            <span className="hint" style={{ color: "var(--good)" }}>
              <IconCheck size={13} /> Saved
            </span>
          )}
          {!saved && dirty && <span className="hint">Unsaved changes</span>}
          <Button variant="ghost" onClick={() => setValues(base)} disabled={!dirty || pending}>
            <IconArrowBackUp size={13} /> Reset
          </Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={pending || !dirty}>
            <IconDeviceFloppy size={13} /> {pending && busy === "save" ? "Saving…" : "Save changes"}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={pending || !dirty}>
            <IconWorldUpload size={13} /> {pending && busy === "publish" ? "Saving…" : "Save & Publish"}
          </Button>
        </div>
      </div>

      {/* Draws the version currently SELECTED, not the saved one — the question this
          pane answers is what the switch is about to publish. */}
      <PreviewFrame label={`Hero Preview — ${version} (affected by config changes)`}>
        <HeroPreview
          version={version}
          titles={rows.titles}
          name={values["name"] || "Yatin"}
          tagline={tagline}
          intro={intro}
          skills={rows.skills}
          socialLinks={rows.socialLinks}
          avatarUrl={values["avatarUrl"] || ""}
          photos={photos}
          availabilityStatus={values["availabilityStatus"] || ""}
          totalSkills={totalSkills}
        />
      </PreviewFrame>
    </>
  );
}
