"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ColorField } from "@/components/ui/color-field";
import { PhotoList } from "./photo-list";
import {
  KEYS, NUMBER_RANGE, clampNumber, DOT_PRESETS, NAP_STYLES, PROJECT_LAYOUTS,
  type ConfigControl, type ConfigKeyDef,
} from "@/lib/site-config-keys";
import { updateSiteConfig } from "@/lib/actions/site-config";
import { publishSite } from "@/lib/actions/publish";
import {
  IconAlertTriangle, IconArrowBackUp, IconCheck, IconDeviceFloppy, IconWorldUpload,
} from "@tabler/icons-react";

export interface ConfigGroup {
  n?: string;
  title: string;
  blurb?: string;
  keys: string[];
  slot?: React.ReactNode;
}

export interface ControlContext {
  value: string;
  set: (next: string) => void;
  def: ConfigKeyDef;
  values: Record<string, string>;
  disabled: boolean;
}

export function ConfigCard({
  groups,
  values: initial,
  controls,
  extraDefs,
  isDisabled,
  heading,
  onDraftChange,
}: {
  groups: ConfigGroup[];
  values: Record<string, string>;
  extraDefs?: Record<string, ConfigKeyDef>;
  controls?: Record<string, (ctx: ControlContext) => React.ReactNode>;
  isDisabled?: (key: string, values: Record<string, string>) => boolean;
  heading?: (group: ConfigGroup) => React.ReactNode;
  onDraftChange?: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [base, setBase] = useState<Record<string, string>>(initial);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);

  const defs = useMemo(() => ({ ...KEYS, ...extraDefs }), [extraDefs]);

  // only the keys these groups declare are ever posted
  const owned = useMemo(
    () => groups.flatMap((g) => g.keys).filter((k) => k in defs),
    [groups, defs]
  );

  const dirtyKeys = owned.filter((k) => (values[k] ?? "") !== (base[k] ?? ""));
  const dirty = dirtyKeys.length > 0;

  useEffect(() => { onDraftChange?.(values); }, [values, onDraftChange]);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = (publish: boolean) => {
    setBusy(publish ? "publish" : "save");
    setPubError(null);
    startTransition(async () => {
      try {
        const snapshot = { ...values };
        for (const key of owned) {
          if (key in NUMBER_RANGE) snapshot[key] = String(clampNumber(key, snapshot[key] ?? ""));
        }
        setValues(snapshot);
        await updateSiteConfig(owned.map((key) => ({ key, value: snapshot[key] ?? "" })));
        setBase(snapshot);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        if (publish) {
          const res = await publishSite();
          if (!res.ok) setPubError(res.error ?? "Could not reach the site.");
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const field = (key: string): React.ReactNode => {
    const def = defs[key];
    if (!def) return null;
    const value = values[key] ?? "";
    const disabled = isDisabled?.(key, values) ?? false;
    const ctx: ControlContext = { value, set: (v) => set(key, v), def, values, disabled };
    const override = controls?.[key];
    if (override) return <div key={key}>{override(ctx)}</div>;

    switch (def.control) {
      case "color":
        return (
          <ColorField
            key={key}
            label={def.label}
            hint={def.description}
            value={value}
            onChange={(v) => set(key, v)}
            presets={DOT_PRESETS}
            fallback="#FAFAFA"
            defaultLabel="Theme default"
            defaultHint="Follow the site's text colour — black in light mode, white in dark"
          />
        );
      case "toggle":
        return (
          <div className="f" key={key}>
            <label>{def.label}</label>
            <div style={{ height: 36, display: "flex", alignItems: "center" }}>
              <Switch
                checked={(value || "on") !== "off"}
                disabled={disabled}
                onChange={(on) => set(key, on ? "on" : "off")}
                label={(value || "on") !== "off" ? "Pulsing" : "Still"}
              />
            </div>
            <div className="f-hint">{def.description}</div>
          </div>
        );
      case "number":
        return (
          <Input
            key={key}
            label={def.label}
            hint={def.description}
            type="number"
            min={NUMBER_RANGE[key]?.min}
            max={NUMBER_RANGE[key]?.max}
            step={1}
            disabled={disabled}
            value={value}
            onChange={(e) => set(key, e.target.value)}
            // the action clamps silently and does not report back
            onBlur={(e) => set(key, String(clampNumber(key, e.target.value)))}
          />
        );
      case "long":
        return (
          <Textarea
            key={key}
            label={def.label}
            hint={def.description}
            rows={3}
            disabled={disabled}
            value={value}
            onChange={(e) => set(key, e.target.value)}
          />
        );
      case "photoList":
        return (
          <PhotoList
            key={key}
            label={def.label}
            hint={def.description}
            value={value}
            onChange={(v) => set(key, v)}
          />
        );
      case "napStyle":
        return (
          <Select
            key={key}
            label={def.label}
            hint={def.description}
            options={NAP_STYLES}
            value={NAP_STYLES.some((o) => o.value === value) ? value : NAP_STYLES[0]!.value}
            onChange={(e) => set(key, e.target.value)}
          />
        );
      case "versionTiles":
        return (
          <Select
            key={key}
            label={def.label}
            hint={def.description}
            options={PROJECT_LAYOUTS.map((l) => ({ value: l.value, label: `${l.value} — ${l.name}` }))}
            value={PROJECT_LAYOUTS.some((l) => l.value === value) ? value : PROJECT_LAYOUTS[0]!.value}
            onChange={(e) => set(key, e.target.value)}
          />
        );
      default:
        return (
          <Input
            key={key}
            label={def.label}
            hint={def.description}
            mono={def.control === "mono"}
            disabled={disabled}
            value={value}
            onChange={(e) => set(key, e.target.value)}
          />
        );
    }
  };

  const FULL_WIDTH = new Set<ConfigControl>(["long", "napStyle", "photoList", "versionTiles"]);

  const fields = (keys: string[]) => {
    const out: React.ReactNode[] = [];
    let buf: string[] = [];
    const flush = () => {
      while (buf.length) {
        const pair = buf.slice(0, 2);
        buf = buf.slice(2);
        out.push(<div className="f-row" key={pair.join("+")}>{pair.map(field)}</div>);
      }
    };
    for (const key of keys) {
      const control = defs[key]?.control;
      if (control && FULL_WIDTH.has(control)) {
        flush();
        out.push(field(key));
      } else buf.push(key);
    }
    flush();
    return out;
  };

  const footer = (
    <>
      {pubError && (
        <div className="cfg-err">
          <IconAlertTriangle size={14} stroke={1.6} />
          <span>The changes are saved. Publishing failed ({pubError}) — retry with Publish, top right.</span>
        </div>
      )}
      <div className="cfg-foot">
        <span className="cfg-note" aria-live="polite">
          {saved && !pubError ? (
            <span style={{ color: "var(--good)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconCheck size={13} stroke={2} /> Saved
            </span>
          ) : dirty ? (
            <>
              {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? "field" : "fields"}. Saves on its own —
              not in the save bar.
            </>
          ) : (
            <>Saves on its own — not in the save bar.</>
          )}
        </span>
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
    </>
  );

  return (
    <>
      {groups.map((g, i) => {
        const keys = g.keys.filter((k) => k in defs);
        const groupDirty = keys.some((k) => dirtyKeys.includes(k));
        const last = i === groups.length - 1;
        return (
          <Fragment key={g.title}>
            {heading?.(g)}
            <Card flush className={groupDirty ? "cfg-dirty" : undefined}>
              <CardHead
                title={g.title}
                count={keys.length}
                right={groupDirty ? <Badge className="amb">unsaved</Badge> : undefined}
              />
              <div className="card-b" style={{ paddingBottom: 2 }}>
                {g.blurb && <div className="f-hint" style={{ marginBottom: 13 }}>{g.blurb}</div>}
                {fields(keys)}
              </div>
              {/* not a field, rides the card keyline */}
              {g.slot && <div style={{ borderTop: "1px solid var(--line2)" }}>{g.slot}</div>}
              {last && footer}
            </Card>
          </Fragment>
        );
      })}
    </>
  );
}
