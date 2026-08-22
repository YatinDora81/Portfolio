"use client";

import { useState, useTransition } from "react";
import type { FlagDefinition } from "@repo/shared/flags";
import { Card, CardHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setFlag } from "@/lib/actions/flags";
import {
  IconAlertTriangle, IconCircleCheck, IconRefresh, IconDeviceFloppy,
} from "@tabler/icons-react";

export interface FlagRow {
  key: string;
  label: string;
  description: string;
  group: FlagDefinition["group"];
  enabled: boolean;
  defaultEnabled: boolean;
  note: string | null;
  /** False when the registry declares this flag but no database row holds it. */
  present: boolean;
  /** Pre-formatted IST, not a Date. */
  changedAt: string | null;
  changedBy: string | null;
}

// `stale` = the write landed but the flush did not.
type Outcome =
  | { kind: "saved" }
  | { kind: "stale"; error: string }
  | { kind: "failed"; error: string };

// Must be caught at every call site: a throw inside a transition reaches no error boundary.
function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function Result({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "saved") {
    return (
      <div className="rv-ok fl-out">
        <IconCircleCheck size={12} stroke={1.8} /> saved · live from the next visit onward
      </div>
    );
  }
  if (outcome.kind === "stale") {
    return (
      <div className="fl-warn fl-out">
        <b><IconAlertTriangle size={13} stroke={1.7} /> Saved, but the site was not flushed</b>
        The switch below is what the database says. Visitors keep seeing the old version until the
        cache clears on its own — flush <code>flags</code> by hand from Revalidation.
        <span>{outcome.error}</span>
      </div>
    );
  }
  return <div className="rv-err fl-out">{outcome.error}</div>;
}

function lastChanged(row: FlagRow, justSavedBy: string | null): string {
  if (justSavedBy !== null) return `just now · by ${justSavedBy}`;
  if (!row.present) return "never saved — this flag has no row yet";
  // No author means the seed created it and nobody has touched it since.
  const who = row.changedBy ?? "the seed";
  return `last changed ${row.changedAt} · by ${who}`;
}

function FlagCard({ row, actor }: { row: FlagRow; actor: string }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [note, setNote] = useState(row.note ?? "");
  const [savedNote, setSavedNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [justSavedBy, setJustSavedBy] = useState<string | null>(null);
  const [, start] = useTransition();

  const dirty = note.trim() !== savedNote;

  // Optimistic, and deliberately no router.refresh(): arriving props would race the switch mid-flight.
  const save = (next: boolean, nextNote: string | undefined) => {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    setOutcome(null);
    start(async () => {
      try {
        const res = await setFlag({
          key: row.key,
          enabled: next,
          ...(nextNote === undefined ? {} : { note: nextNote }),
        });

        if (!res.ok) {
          setEnabled(previous);
          setOutcome({ kind: "failed", error: res.error ?? "The change was not saved." });
          return;
        }

        if (nextNote !== undefined) {
          const stored = nextNote.trim();
          setSavedNote(stored);
          setNote(stored);
        }
        setJustSavedBy(actor);
        setOutcome(
          res.revalidated
            ? { kind: "saved" }
            : {
                kind: "stale",
                error: res.revalidateError ?? "The flush failed, and returned no error text.",
              }
        );
      } catch (e) {
        setEnabled(previous);
        setOutcome({ kind: "failed", error: transportError(e) });
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="row fl-row">
      <div className="row-main">
        <div className="fl-head">
          <span className="fl-name">{row.label}</span>
          <code className="fl-key">{row.key}</code>
          {!row.present ? <Badge variant="warning">no row</Badge> : null}
          {!enabled ? <Badge variant="destructive" dot>off</Badge> : null}
          {enabled !== row.defaultEnabled ? (
            <span className="fl-def">default {row.defaultEnabled ? "on" : "off"}</span>
          ) : null}
        </div>

        <div className="fl-desc">{row.description}</div>
        <div className="fl-meta">{lastChanged(row, justSavedBy)}</div>

        <div className="fl-noterow">
          <input
            className="in fl-note"
            value={note}
            maxLength={500}
            disabled={busy}
            aria-label={`Note for ${row.label}`}
            placeholder="why is this off?"
            onChange={(e) => setNote(e.target.value)}
          />
          {dirty ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => save(enabled, note)}>
              <IconDeviceFloppy size={13} stroke={1.6} /> Save note
            </Button>
          ) : null}
        </div>

        {outcome ? <Result outcome={outcome} /> : null}
      </div>

      <div className="fl-switch">
        {busy ? <IconRefresh size={13} className="spin" /> : null}
        {/* No note passed, so a half-typed draft cannot be committed by flipping the switch. */}
        <Switch
          checked={enabled}
          disabled={busy}
          ariaLabel={row.label}
          onChange={(next) => save(next, undefined)}
        />
      </div>
    </div>
  );
}

// Declared order, not alphabetical.
const GROUPS: FlagDefinition["group"][] = ["Sections", "System"];

const GROUP_BLURB: Record<FlagDefinition["group"], string> = {
  Sections:
    "One band of the public homepage each. Off means the section is not rendered at all — no gap, no placeholder, and its nav link goes with it.",
  System:
    "Behaviour rather than layout. A visitor sees nothing change until one of these is off, which is exactly when it matters.",
};

export function FlagBoard({ rows, actor }: { rows: FlagRow[]; actor: string }) {
  return (
    <>
      {GROUPS.map((group) => {
        const inGroup = rows.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <Card key={group} flush className="rv-card">
            <CardHead title={group} count={inGroup.length} />
            <div className="fl-blurb">{GROUP_BLURB[group]}</div>
            <div className="rows">
              {inGroup.map((r) => (
                <FlagCard key={r.key} row={r} actor={actor} />
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
