"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PreviewFrame } from "@/components/preview";
import { CatPreview } from "@/components/preview/cat";
import { NapStylePicker } from "./nap-style-picker";
import { NAP_STYLES } from "@/lib/site-config-keys";
import { updateSiteConfig } from "@/lib/actions/site-config";
import { publishSite } from "@/lib/actions/publish";
import {
  IconAlertTriangle, IconArrowBackUp, IconCheck, IconDeviceFloppy, IconWorldUpload, IconZzz,
} from "@tabler/icons-react";

// mirrors the clamps in data.ts and site-config.ts
const MIN = 3;
const MAX = 300;
const FALLBACK = 30;

function clampSeconds(raw: string) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return FALLBACK;
  return Math.min(MAX, Math.max(MIN, n));
}

const SHORTCUTS = [
  { secs: 10, label: "10s" },
  { secs: 30, label: "30s" },
  { secs: 60, label: "1m" },
  { secs: 120, label: "2m" },
  { secs: 300, label: "5m" },
];

function secsLabel(n: number) {
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const rest = n % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

export function CatConsole({
  napStyle,
  napSeconds,
  children,
}: {
  napStyle: string;
  napSeconds: string;
  children?: React.ReactNode;
}) {
  const initial = useMemo(
    () => ({ catNapStyle: napStyle, catNapSeconds: napSeconds }),
    [napStyle, napSeconds]
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [base, setBase] = useState<Record<string, string>>(initial);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);

  const styleDirty = values["catNapStyle"] !== base["catNapStyle"];
  const secsDirty = values["catNapSeconds"] !== base["catNapSeconds"];
  const dirty = styleDirty || secsDirty;

  const style = NAP_STYLES.some(o => o.value === values["catNapStyle"])
    ? values["catNapStyle"]!
    : NAP_STYLES[0]!.value;
  const napsOff = style === "off";
  const seconds = clampSeconds(values["catNapSeconds"] ?? "");

  const set = (key: string, value: string) => setValues(prev => ({ ...prev, [key]: value }));

  const handleSave = (publish: boolean) => {
    setBusy(publish ? "publish" : "save");
    setPubError(null);
    startTransition(async () => {
      try {
        const snapshot = {
          catNapStyle: style,
          catNapSeconds: String(clampSeconds(values["catNapSeconds"] ?? "")),
        };
        setValues(snapshot);
        await updateSiteConfig(Object.entries(snapshot).map(([key, value]) => ({ key, value })));
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

  const edge = (on: boolean) => `cat-card${on ? " is-dirty" : ""}`;
  const unsaved = (on: boolean) => (on ? <Badge variant="warning">unsaved</Badge> : undefined);

  return (
    <>
      <div className="grid gap-3">
        <Card flush className={edge(styleDirty)}>
          <CardHead title="How it naps" count={NAP_STYLES.length} right={unsaved(styleDirty)} />
          <div className="card-b">
            <NapStylePicker
              label="Nap style"
              hint="What the cat shows while it sleeps. Every tile is the real indicator, drawn from the same numbers the site runs on."
              options={NAP_STYLES}
              value={style}
              onChange={v => set("catNapStyle", v)}
              napSeconds={seconds}
            />
          </div>
        </Card>

        <Card flush className={edge(secsDirty)}>
          <CardHead
            title="How long it naps"
            right={napsOff ? <Badge variant="outline">not in use</Badge> : unsaved(secsDirty)}
          />
          <div className="card-b">
            <div className="cat-secs" aria-disabled={napsOff}>
              <Input
                label="Nap length"
                type="number"
                min={MIN}
                max={MAX}
                step={1}
                disabled={napsOff}
                value={values["catNapSeconds"] ?? ""}
                onChange={e => set("catNapSeconds", e.target.value)}
                // the action clamps silently, so settle the value here
                onBlur={e => set("catNapSeconds", String(clampSeconds(e.target.value)))}
                hint={`Seconds, ${MIN}–${MAX}.`}
              />
              <div className="cat-shorts" role="group" aria-label="Nap length shortcuts">
                {SHORTCUTS.map(s => (
                  <button
                    key={s.secs}
                    type="button"
                    disabled={napsOff}
                    aria-pressed={!napsOff && seconds === s.secs}
                    className={`filt${!napsOff && seconds === s.secs ? " on" : ""}`}
                    onClick={() => set("catNapSeconds", String(s.secs))}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="cat-say" aria-live="polite">
              {napsOff ? (
                <>
                  The cat <b>never sleeps</b>. It still follows the pointer and can still be picked
                  up and dropped anywhere — the drop just doesn&rsquo;t start a nap, and the
                  &ldquo;let go — I&rsquo;ll nap right here&rdquo; toast stays quiet.
                </>
              ) : (
                <>
                  Dropped within <i>64px</i> of any window edge, the cat sleeps for{" "}
                  <i>{secsLabel(seconds)}</i> showing the <i>{style}</i> indicator, then wakes and
                  goes back to chasing the pointer. A click wakes it early.
                </>
              )}
            </p>
          </div>
        </Card>

        {pubError && (
          <div className="hint" style={{ color: "var(--bad)", lineHeight: 1.5 }}>
            <IconAlertTriangle size={14} stroke={1.6} style={{ flexShrink: 0 }} />
            <span>The changes are saved. Publishing failed ({pubError}) — retry with Publish, top right.</span>
          </div>
        )}

        <div className={`cat-foot${dirty ? " is-dirty" : ""}`}>
          <span className="cat-foot-note">
            <IconZzz size={13} stroke={1.7} />
            Saves on its own — not in the save bar.
          </span>
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

        {children}
      </div>

      <PreviewFrame label="Cat — hero ↔ about divider">
        <CatPreview napStyle={style} napSeconds={seconds} />
      </PreviewFrame>
    </>
  );
}
