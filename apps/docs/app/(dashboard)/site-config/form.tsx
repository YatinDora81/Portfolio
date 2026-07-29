"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ColorField } from "@/components/ui/color-field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

/**
 * Presentation only — which card a key lands in and how wide it renders.
 * Keys missing from here still render (in a trailing "Other" card), so the
 * form can never silently drop a SiteConfig row.
 */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Identity", keys: ["name", "navbarLogo", "avatarUrl", "copyrightName"] },
  { title: "Contact & availability", keys: ["contactEmail", "availabilityStatus", "availabilityDetail"] },
  { title: "Hero status dot", keys: ["heroDotColor", "heroDotPulse"] },
  { title: "Corner-nap cat", keys: ["catNapStyle", "catNapSeconds"] },
];
/** Sentence-length copy — gets a full-width textarea. */
const LONG = new Set(["availabilityDetail"]);
/** URLs / addresses — mono face. */
const MONO = new Set(["avatarUrl", "contactEmail"]);
/** Hex-valued — swatch, typed hex and presets instead of a text box. */
const COLOR = new Set(["heroDotColor"]);
/** "on" / "off" rows — a switch, so the stored strings never have to be typed. */
const TOGGLE = new Set(["heroDotPulse"]);
/**
 * Fixed-vocabulary rows — a dropdown, so a typo can't reach a row the cat's
 * script would silently reject. The label carries the description because the
 * six styles are impossible to tell apart by name alone.
 */
const SELECT: Record<string, { value: string; label: string }[]> = {
  catNapStyle: [
    { value: "ticks", label: "Ticks — watch-face dial around the cat" },
    { value: "moon", label: "Moon — crescent crosses a starry arc overhead" },
    { value: "pixel", label: "Pixel — 8-bit speech bubble with a block bar" },
    { value: "halo", label: "Halo — breathing emerald glow, no numbers" },
    { value: "ring", label: "Ring — thin progress ring, seconds on hover" },
    { value: "tooltip", label: "Tooltip — micro pill, seconds and a draining border" },
    { value: "random", label: "Random — a different one every nap" },
    { value: "off", label: "Never sleeps — still draggable, just never naps" },
  ],
};
/** Whole-number rows, with the range the site clamps to anyway. */
const NUMBER: Record<string, { min: number; max: number }> = {
  catNapSeconds: { min: 3, max: 300 },
};
/** The value the row would hold after `updateSiteConfig` has had it. */
const NUMBER_FALLBACK: Record<string, number> = { catNapSeconds: 30 };
function clampNumber(key: string, raw: string) {
  const range = NUMBER[key]!;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return NUMBER_FALLBACK[key] ?? range.min;
  return Math.min(range.max, Math.max(range.min, n));
}

/**
 * Offered next to the picker. Status greens first (what a live availability dot
 * usually wants), then the accents the site already uses elsewhere.
 */
const DOT_PRESETS = [
  { value: "#22C55E", label: "Green" },
  { value: "#10B981", label: "Emerald" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#A855F7", label: "Violet" },
  { value: "#F43F5E", label: "Rose" },
];

export function SiteConfigForm({
  configs,
  liveHero,
  hero,
  photos,
  totalSkills,
}: {
  configs: ConfigEntry[];
  /** The hero the site is serving, read-only here — its copy and the switch that
      picks it are edited on /hero, through the save bar. Carried only so this
      page's preview draws the real hero under the name and avatar being typed. */
  liveHero: { version: HeroVersion; intro: string; tagline: string };
  hero: HeroRows;
  photos: string[];
  /** Drives v2's "+N more" chip — the Skills section's visible row count. */
  totalSkills?: number;
}) {
  const initial = useMemo(
    () => Object.fromEntries(configs.map(c => [c.key, c.value])),
    [configs]
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
        // Clamped here as well as on blur, because clicking Save is what blurs
        // the field — and the action rewrites out-of-range numbers without
        // reporting back, so anything it would change has to be settled before
        // it goes, or the box sits there showing 600 under a green "Saved".
        const snapshot = { ...values };
        for (const key of Object.keys(NUMBER)) {
          if (key in snapshot) snapshot[key] = String(clampNumber(key, snapshot[key] ?? ""));
        }
        setValues(snapshot);
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

  // Nap length is dead config once the cat never sleeps — leaving it live next
  // to the switch that disabled it invites tuning a number nothing reads.
  const napsOff = values["catNapStyle"] === "off";

  const field = (c: ConfigEntry): React.ReactNode =>
    COLOR.has(c.key) ? (
      <ColorField
        key={c.key}
        label={c.label}
        hint={c.description}
        value={values[c.key] ?? ""}
        onChange={v => set(c.key, v)}
        presets={DOT_PRESETS}
        // What the site renders with no colour set: `--foreground`, which is
        // near-black on the light theme and near-white on the dark one.
        fallback="#FAFAFA"
        defaultLabel="Theme default"
        defaultHint="Follow the site's text colour — black in light mode, white in dark"
      />
    ) : SELECT[c.key] ? (
      <Select
        key={c.key}
        label={c.label}
        hint={c.description}
        options={SELECT[c.key]!}
        // A stored value outside the list would leave the control blank with no
        // way to tell what the site is doing — show the fallback it serves.
        value={
          SELECT[c.key]!.some(o => o.value === values[c.key])
            ? values[c.key]!
            : SELECT[c.key]![0]!.value
        }
        onChange={e => set(c.key, e.target.value)}
      />
    ) : NUMBER[c.key] ? (
      <Input
        key={c.key}
        label={c.label}
        hint={c.description}
        type="number"
        min={NUMBER[c.key]!.min}
        max={NUMBER[c.key]!.max}
        step={1}
        disabled={napsOff}
        value={values[c.key] ?? ""}
        onChange={e => set(c.key, e.target.value)}
        // The action clamps on the way in, and it does not report back — so
        // without this the box keeps showing 500 next to a green "Saved" while
        // the row holds 300, and an emptied box silently becomes the default.
        onBlur={e => set(c.key, String(clampNumber(c.key, e.target.value)))}
      />
    ) : TOGGLE.has(c.key) ? (
      <div className="f" key={c.key}>
        <label>{c.label}</label>
        <div style={{ height: 36, display: "flex", alignItems: "center" }}>
          <Switch
            checked={(values[c.key] ?? "on") !== "off"}
            onChange={on => set(c.key, on ? "on" : "off")}
            label={(values[c.key] ?? "on") !== "off" ? "Pulsing" : "Still"}
          />
        </div>
        <div className="f-hint">{c.description}</div>
      </div>
    ) : LONG.has(c.key) ? (
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

  return (
    <>
      <div className="grid gap-3">
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

      {/* The live hero, drawn with the fields on this page applied — so a new name
          or avatar can be seen in place. The copy and the version itself are not
          editable here; they belong to the save bar on /hero. */}
      <PreviewFrame label={`Hero Preview — ${liveHero.version} live (affected by config changes)`}>
        <HeroPreview
          version={liveHero.version}
          titles={hero.titles}
          name={values["name"] || "Yatin"}
          tagline={liveHero.tagline}
          intro={liveHero.intro}
          skills={hero.skills}
          socialLinks={hero.socialLinks}
          avatarUrl={values["avatarUrl"] || ""}
          photos={photos}
          availabilityStatus={values["availabilityStatus"] || ""}
          dotColor={values["heroDotColor"] || ""}
          dotPulse={(values["heroDotPulse"] ?? "on") !== "off"}
          totalSkills={totalSkills}
        />
      </PreviewFrame>
    </>
  );
}
